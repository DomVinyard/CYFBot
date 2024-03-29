import addRecord from "../queries/addRecord.graphql";
import database from "../../../clients/apollo";
import { studentHome } from "./mentionStudent";

// When the user sumbits the 'edit field' modal
// save it to the database and refresh the student home form

export default function (slack) {
  slack.view(
    "SAVE_UPDATE_VALUE",
    async ({ ack, body, view, say, client }: any) => {
      try {
        const value =
          body.view.state.values.view.input?.value ||
          body.view.state.values.view.value.selected_option?.value;
        const metadata = JSON.parse(body.view.private_metadata || {});
        const { schemaItem, studentID, studentName, timestamp, channelID } =
          metadata;
        const reporter = body.user.id;
        const key = schemaItem.key;
        const team = body.team.id;
        const variables = { team, student: studentID, reporter, key, value };
        console.log({ variables });
        await database.mutate({ mutation: addRecord, variables });
        await ack();
        const homeBlocks = await studentHome({
          studentName,
          studentID,
          timestamp,
          slackClient: client,
        });
        await client.chat.update({
          channel: channelID,
          ts: timestamp,
          text: "",
          as_user: true,
          blocks: homeBlocks,
        });
      } catch (e) {
        console.error(e);
      }
    }
  );
}
