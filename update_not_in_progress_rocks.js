import * as dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import _ from "underscore";
const urls = process.env;

/*
 **
 **  getSlackUsers
 **
 */

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

/*
 **
 **  getRocksNotInProgressByUser
 **
 */
const getRocksNotInProgressByUser = async () => {
  const rockStatuses = {
    in_progress: "in_progress", // (Not Started)
    ready_for_review: "ready_for_review", // (In Progress)
    complete: "complete", // (Complete)
  };

  const smartSuiteConfig = {
    headers: {
      Authorization: process.env.SMART_SUITE_TOKEN,
      "Account-Id": process.env.SMART_SUITE_ACCOUNT_ID,
    },
  };

  const rocksData = await axios.get(urls.GET_ROCKS_URL, smartSuiteConfig);
  const rocks = rocksData.data.records;

  if (!rocks || rocks.length === 0) return;

  const groupedRocksByUser = _.groupBy(rocks, (rock) => rock.assigned_to[0]);

  const rocksNotStarted = [];

  Object.values(groupedRocksByUser).forEach((groupRocksByUser) => {
    const areAllRocksInProgress = groupRocksByUser.every((rock) => {
      return rock.status.value === rockStatuses.in_progress;
    });

    if (areAllRocksInProgress) rocksNotStarted.push(groupRocksByUser[0]);
  });

  return rocksNotStarted;
};

/*
 **
 **  getMembersToBeNotified
 **
 */

const getMembersToBeNotified = async (rocks) => {
  const smartSuiteConfig = {
    headers: {
      Authorization: process.env.SMART_SUITE_TOKEN,
      "Account-Id": process.env.SMART_SUITE_ACCOUNT_ID,
    },
  };

  const membersData = await axios.post(
    urls.GET_MEMBERS_URL,
    {},
    smartSuiteConfig
  );

  const members = membersData.data.items;
  const membersToBeNotified = [];

  members.forEach((member) => {
    const rockNotInProgressByUser = rocks.find(
      (rock) => rock.assigned_to[0] === member.id
    );

    if (!rockNotInProgressByUser) return;

    membersToBeNotified.push({ ...member, rock: rockNotInProgressByUser });
  });

  return membersToBeNotified;
};

/*
 **
 **  getMembersAndSlackId
 **
 */

const getMembersAndSlackId = (membersToBeNotified, slackUsers) => {
  const membersWithSlackId = [];

  membersToBeNotified.forEach((member) => {
    const slackUser = slackUsers.find(
      (user) => user.profile.real_name_normalized === member.full_name.sys_root
    );

    if (!slackUser) return;

    membersWithSlackId.push({ ...member, slackId: slackUser.id });
  });

  return membersWithSlackId;
};

/*
 **
 **  sendSlackMessage
 **
 */

const sendSlackMessage = async (message, members) => {
  return members.map(async (member) => {
    const slackViewConfig = {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_OAUTH_TOKEN}`,
      },
    };

    const body = {
      channel: member.slackId,
      as_user: "Rocks-Bot",
      text: message,
      pretty: "1",
    };

    await axios.post(urls.SEND_SLACK_MESASGE_URL, body, slackViewConfig);
  });
};

/*
 **
 **  messageTemplate
 **
 */

const messageTemplate = () => {
  const howToCompleteAnyRockUrl =
    "https://app.gitbook.com/o/-MKgZVdiD84BirEX9cXC/s/xrAeYN3SlbpcpvJ5VCRT/how-to-complete-any-rock";

  return `You aren't currently working on any rocks yet! How about reading  <${howToCompleteAnyRockUrl}|How To Complete Any Rock> and get a rock started today?`;
};

/*
 **
 **  runSendMessageIfNoRockStarted
 **
 */

const runSendMessageIfNoRockStarted = async () => {
  try {
    const rockNotInProgressByUser = await getRocksNotInProgressByUser();
    const membersToBeNotified = await getMembersToBeNotified(
      rockNotInProgressByUser
    );

    const slackUsers = await getSlackUsers();

    const membersWithSlackId = getMembersAndSlackId(
      membersToBeNotified,
      slackUsers
    );

    const message = messageTemplate();

    await Promise.all(sendSlackMessage(message, membersWithSlackId));
  } catch (error) {
    console.error(error.response);
  }
};

runSendMessageIfNoRockStarted();
