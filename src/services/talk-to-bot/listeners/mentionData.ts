import helpOptions from "../blocks/helpOptions";
import schemaBlocks from "../blocks/schemaList";
import { getSchema } from "../../../clients/apollo";
import slack, { getSlackChannels } from "../../../clients/slack";

// When the user asks for help
// Display the schema list

export default async function ({ say, timestamp, client }) {
  const schema = await getSchema();
  const channels = await getSlackChannels();
  const mentors = [];
  await say({
    blocks: [
      ...(await helpOptions({ schema, timestamp, mentors, channels, client })),
    ],
    text: "",
    thread_ts: timestamp,
  });
}
