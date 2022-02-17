import database, { getSchema } from "../clients/apollo";
import getStudent from "../queries/getStudent.graphql";
import getCheckInReporters from "../queries/getCheckInReporters.graphql";
import { json2csvAsync } from "json-2-csv";
import { google } from "googleapis";

// When the user #mention's a channel
// Generate a Google Sheet and email it to them

const getAllMessages = async ({ client, channelID }) => {
  let allMessages = [];
  const fetchSlice = async ({ next_cursor }) => {
    const response = await client.conversations.history({
      channel: channelID,
      ...(next_cursor ? { cursor: next_cursor } : { limit: 100 }),
    });
    allMessages = [...allMessages, ...response.messages];
    if (response.response_metadata.next_cursor) {
      await fetchSlice({ next_cursor: response.response_metadata.next_cursor });
    }
  };
  await fetchSlice({ next_cursor: false });
  return allMessages;
};

export default async function ({ say, client, channelID, reporterID }) {
  const { profile } = await client.users.profile.get({ user: reporterID });
  const { channel: cohortInfo } = await client.conversations.info({
    channel: channelID,
  });
  const PUBLIC_EMAIL_FIELD_ID = "Xf01G06F0KJ6";
  const email = profile?.fields?.[PUBLIC_EMAIL_FIELD_ID]?.value;

  if (!email) {
    return say({
      text: `Cannot generate a report because you have no email address set. Please check your profile.`,
    });
  }

  // Check bot has access to channel
  await client.conversations.history({ channel: channelID, limit: 1 });
  say({
    text: `I'll generate a report for #${cohortInfo.name} and send it to ${email}. Keep an eye on your inbox.`,
  });

  const schema = await getSchema();
  const { members: cohortList } = await client.conversations.members({
    channel: channelID,
  });
  const { members: volunteerList } = await client.conversations.members({
    channel: process.env.ACCESS_CHANNEL_ID,
  });
  //
  // Fetch total number of messages sent in the channel
  const allMessages = await getAllMessages({ client, channelID });
  //
  // Fetch data for all members of channel (filter out volunteers)
  const cohort = (await Promise.all(
    cohortList
      .filter((studentID) => !volunteerList.includes(studentID))
      .map(async (studentID) => {
        const { profile } = await client.users.profile.get({ user: studentID });
        const { data } = await database.query({
          query: getStudent,
          variables: { studentID },
          fetchPolicy: "network-only",
        });

        // Collate reporters
        const { data: reporterData } = await database.query({
          query: getCheckInReporters,
          variables: { studentID },
          fetchPolicy: "network-only",
        });
        const reporterCounts = reporterData.updates.nodes.reduce(
          (acc, { reporter }) => ({
            ...acc,
            [reporter]: (acc[reporter] || 0) + 1,
          }),
          {}
        );
        const reporters = [];
        for (const [user] of Object.entries(reporterCounts).sort((a, b) =>
          b[1] > a[1] ? 1 : -1
        )) {
          const { profile } = await client.users.profile.get({ user });
          const reporterName = profile.real_name;
          reporters.push(`${reporterName}`);
        }
        return {
          "Student ID": studentID,
          Name: profile.real_name,
          ...[...schema]
            .map(({ key, label, default_value, integration }) => {
              const dbVal = data.updates?.nodes?.find(
                ({ key: k }) => k === key
              )?.value;
              const value = integration
                ? "🔗"
                : dbVal || default_value || "Unknown";
              return { column: label, value };
            })
            .reduce(
              (acc, { column, value }) => ({ ...acc, [column]: value }),
              {}
            ),
          "Slack Messages": allMessages.filter((m) => m.user === studentID)
            .length,
          "Check-ins": data.quick_ALL.aggregate.count,
          Overachieving: !data.quick_OVERACHIEVING.aggregate.count
            ? "0%"
            : `${
                (data.quick_OVERACHIEVING.aggregate.count /
                  data.quick_ALL.aggregate.count) *
                100
              }%`,
          Concerns: data.quick_CONCERN.aggregate.count,
          "Check-ins with": reporters.join(", "),
        };
      })
  )) as any;
  //
  // Convert to CSV
  const csv = await json2csvAsync(cohort);

  //
  // Send to google sheets
  const { SHEETS_CLIENT_EMAIL: EMAIL, SHEETS_PRIVATE_KEY: KEY } = process.env;
  const scope = ["https://www.googleapis.com/auth/drive"];
  const JwtClient = new google.auth.JWT(EMAIL, null, KEY, scope);
  const drive = google.drive({ version: "v3", auth: JwtClient });
  const mimeType = "application/vnd.google-apps.spreadsheet";
  const sheetName = `${cohortInfo.name} (${new Date().toISOString()})`;
  const newFile = await drive.files.create({
    requestBody: { name: sheetName, mimeType },
    media: { mimeType: "text/csv", body: csv },
    fields: "id",
  });
  await drive.permissions.create({
    requestBody: { role: "reader", type: "user", emailAddress: email },
    fileId: newFile.data.id,
    fields: "id",
  });
}
