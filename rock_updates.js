import * as dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { NodeHtmlMarkdown } from "node-html-markdown";

const urls = process.env;

export const parseHTMLtoSlackMarkdown = (html) => {
  let markdown = NodeHtmlMarkdown.translate(html, {
    strongDelimiter: "*",
    bulletMarker: "•",
  });

  const linksRegex = /\[([^\[]+)\](\(.*\))/gm;
  const matches = markdown.match(linksRegex);

  matches?.forEach((match) => {
    const link = match.replace(/ \"(.)+\"/, ""); // remove title
    const [title, uri] = link.slice(1, -1).split("](");
    if (!uri.startsWith("http://") || uri.startsWith("https://")) {
      markdown = markdown.replace(match, `<https://${uri}|${title}>`);
    } else {
      markdown = markdown.replace(match, `<${uri}|${title}>`);
    }
  });

  return markdown;
};

const logger = (message, item) => {
  return console.log(`LOGGING ${message} ---->`, item);
};

const rockStatuses = {
  in_progress: "Not Started",
  ready_for_review: "In Progress",
  complete: "Complete",
};

const rockMessageTemplate = (
  userSlackId,
  rockTitle,
  rockId,
  status,
  rockCommentHtml
) => {
  const rockUrl = `${process.env.ROCKS_URL}${rockId}`;

  if (rockCommentHtml) {
    return `<@${userSlackId}> commented on <${rockUrl}|a rock> \n "${rockTitle}" \n\n ${parseHTMLtoSlackMarkdown(
      rockCommentHtml
    )}`;
  }

  return `<@${userSlackId}> updated <${rockUrl}|a rock> status to *${rockStatuses[status]}* \n "${rockTitle}"`;
};

const sendSlackMessage = async (message) => {
  const slackViewConfig = {
    parse: "full",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_OAUTH_TOKEN}`,
    },
  };

  const response = await axios.post(
    urls.ROCKS_UPDATE_CHANNEL_URL,
    { text: message },
    slackViewConfig
  );

  return response;
};

const getSlackUsers = async () => {
  const slackConfig = {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_USER_OAUTH_TOKEN}`,
    },
  };
  const userData = await axios.get(urls.GET_SLACK_USERS, slackConfig);
  const users = userData.data.members;

  return users;
};

const rocksStatusCronJob = async () => {
  const smartSuiteConfig = {
    headers: {
      Authorization: process.env.SMART_SUITE_TOKEN,
      "Account-Id": process.env.SMART_SUITE_ACCOUNT_ID,
    },
  };

  const getPreviousDateTime = () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 15);

    return pastDate.getTime();
  };

  const getRockComments = async (rockId) => {
    const rockCommentsUrl = `https://app.smartsuite.com/api/v1/comments?record=${rockId}`;
    const result = await axios.get(rockCommentsUrl, smartSuiteConfig);

    return result.data.results;
  };

  const getUpdatedRocks = async () => {
    const smartSuiteConfig = {
      headers: {
        Authorization: process.env.SMART_SUITE_TOKEN,
        "Account-Id": process.env.SMART_SUITE_ACCOUNT_ID,
      },
    };

    const rocksData = await axios.post(
      urls.GET_ROCKS_URL,
      {},
      smartSuiteConfig
    );
    const rocks = rocksData.data.items;
    const fifteenMinutesAgo = getPreviousDateTime();
    const updatedRocks = [];
    const updatedRockComments = [];

    if (!rocks || rocks.length === 0) return;

    await Promise.all(
      rocks.map(async (rock) => {
        const rockComments = await getRockComments(rock.id);
        const lastUpdatedOn = new Date(rock.status.updated_on).getTime();

        if (lastUpdatedOn > fifteenMinutesAgo) {
          updatedRocks.push(rock);
        }

        rockComments.map((comment) => {
          const commentCreatedOn = new Date(comment.created_on).getTime();
          if (commentCreatedOn > fifteenMinutesAgo) {
            updatedRockComments.push({ ...rock, comment });
          }
        });
      })
    );

    return [updatedRocks, updatedRockComments];
  };

  const getMembersToBeNotified = async (updatedRocks, updatedRockComments) => {
    const membersData = await axios.post(
      urls.GET_MEMBERS_URL,
      {},
      smartSuiteConfig
    );
    const members = membersData.data.items;
    const membersToBeNotified = [];

    members.forEach((member) => {
      const rocksFromMember = updatedRocks.filter(
        (rock) => rock.assigned_to[0] === member.id
      );

      const rocksCommentFromMember = updatedRockComments.filter(
        (rockWithComment) => rockWithComment.comment.member === member.id
      );

      if (rocksFromMember.length > 0) {
        rocksFromMember.forEach((rockFromMember) =>
          membersToBeNotified.push({ ...member, rock: rockFromMember })
        );
      }

      if (rocksCommentFromMember.length > 0) {
        rocksCommentFromMember.forEach((rockCommentFromMember) =>
          membersToBeNotified.push({ ...member, rock: rockCommentFromMember })
        );
      }
    });

    return membersToBeNotified;
  };

  const getMembersAndSlackId = (membersToBeNotified, slackUsers) => {
    const notifyMembers = [];

    membersToBeNotified.forEach((member) => {
      const slackUser = slackUsers.find(
        (user) =>
          user.profile.real_name_normalized === member.full_name.sys_root
      );

      if (!slackUser) return;

      notifyMembers.push({ ...member, slackId: slackUser.id });
    });

    return notifyMembers;
  };

  try {
    const [updatedRocks, updatedRockComments] = await getUpdatedRocks();

    logger("updatedRocks", updatedRocks);
    logger("updatedRockComments", updatedRockComments);

    const hasUpdatedRocks = Boolean(updatedRocks && updatedRocks.length > 0);
    const hasUpdatedRockComments = Boolean(
      updatedRockComments && updatedRockComments.length > 0
    );

    if (!hasUpdatedRocks && !hasUpdatedRockComments) return;

    const membersToBeNotified = await getMembersToBeNotified(
      updatedRocks,
      updatedRockComments
    );

    logger("membersToBeNotified", membersToBeNotified);
    const slackUsers = await getSlackUsers();

    const notifyMembers = getMembersAndSlackId(membersToBeNotified, slackUsers);
    logger("notifyMembers", notifyMembers);

    const messages = notifyMembers.map((member) => {
      const userSlackId = member.slackId;
      const rockTitle = member.rock.title;
      const rockId = member.rock.id;
      const status = member.rock.status.value;
      const rockComment = member?.rock?.comment?.message?.html;

      return rockMessageTemplate(
        userSlackId,
        rockTitle,
        rockId,
        status,
        rockComment
      );
    });

    logger("messages", messages);
    sendSlackMessage(messages.join("\n\n"));
  } catch (error) {
    console.log(error.response);
  }
};

rocksStatusCronJob();
