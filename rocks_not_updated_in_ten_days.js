import * as dotenv from "dotenv";
dotenv.config();
import axios from "axios";
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
 **  getRockNotUpdatedInMoreThan10Days
 **
 */
const getRockNotUpdatedInMoreThan10Days = async () => {
  const smartSuiteConfig = {
    headers: {
      Authorization: process.env.SMART_SUITE_TOKEN,
      "Account-Id": process.env.SMART_SUITE_ACCOUNT_ID,
    },
  };

  const rocksData = await axios.post(urls.GET_ROCKS_URL, {}, smartSuiteConfig);
  const rocks = rocksData.data.items;
  const currentDate = new Date();
  if (!rocks || rocks.length === 0) return;

  const rocksNotUpdatedInMoreThan10Days = [];

  rocks.forEach((rock) => {
    const lastUpdatedOn = new Date(rock.last_updated.on);
    const difference = currentDate.getTime() - lastUpdatedOn.getTime();
    const differenceInDays = difference / 1000 / 60 / 60 / 24;

    if (differenceInDays > 10) rocksNotUpdatedInMoreThan10Days.push(rock);
  });

  return rocksNotUpdatedInMoreThan10Days;
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

const sendSlackMessage = async (members) => {
  return members.map(async (member) => {
    const message = messageTemplate(member.rock.title, member.rock.id);

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

const messageTemplate = (rockTitle, rockId) => {
  const rockUrl = `${process.env.ROCKS_URL}${rockId}`;

  const howToCompleteAnyRockUrl =
    "https://app.gitbook.com/o/-MKgZVdiD84BirEX9cXC/s/xrAeYN3SlbpcpvJ5VCRT/how-to-complete-any-rock";

  return ` You haven't updated "<${rockUrl}|${rockTitle}>" for a while. Check out the <${howToCompleteAnyRockUrl}|How To Complete Any Rock> guide for instructions!`;
};

/*
 **
 **  runSendMessageIfNoRockStarted
 **
 */

const runSendMessageIfNoRockStarted = async () => {
  try {
    const rocksNotUpdated = await getRockNotUpdatedInMoreThan10Days();
    const membersToBeNotified = await getMembersToBeNotified(rocksNotUpdated);
    const slackUsers = await getSlackUsers();

    const membersWithSlackId = getMembersAndSlackId(
      membersToBeNotified,
      slackUsers
    );

    await Promise.all(sendSlackMessage(membersWithSlackId));
  } catch (error) {
    console.error(error.response);
  }
};

runSendMessageIfNoRockStarted();
