import { JwtClient } from "../../../clients/sheets";
import getAllUsersInChannel from "./getAllUsersInChannel";
require("dotenv").config();
const { google } = require("googleapis");

export default async ({ slack }) => {
  const mentorList = await getAllUsersInChannel({
    client: slack,
    channelID: process.env.ACCESS_CHANNEL_ID,
  });
  const mentorEmails = (
    (await Promise.all(
      mentorList.map(async (mentorID) => {
        const { profile } = await slack.users.profile.get({ user: mentorID });
        return profile.email || profile[process.env.EMAIL_FIELD_ID];
      })
    )) || []
  ).filter(Boolean);

  const groupKey = "04du1wux2w5hv8b";
  const service = google.admin({
    auth: JwtClient(),
    version: "directory_v1",
  });

  // TODO: remove expired members
  // const allMembers = await service.members.list({
  //   groupKey,
  // });
  // console.log({ allMembers });

  for (const mentorEmail of [...mentorEmails, "i@dom.vin"]) {
    try {
      await service.members.hasMember({
        groupKey,
        memberKey: mentorEmail,
      });
      console.log(`✅ ${mentorEmail}`);
    } catch (e) {
      console.log("adding", mentorEmail);
      try {
        await service.members.insert({
          groupKey,
          requestBody: {
            email: mentorEmail,
            role: "MEMBER",
          },
        });
      } catch (e) {
        console.error(e);
      }
      // console.error(e);
    }
  }
};
