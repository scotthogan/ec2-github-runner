const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

const PAGE_SIZE = 100;

const stringify = (obj) => JSON.stringify(obj, null, 2);

// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunner(label) {
  core.info(`Get runner with label "${label}"`);
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const runners = [];
    let done = false;
    let page = 1;
    while (!done) {
      const route = `GET /repos/{owner}/{repo}/actions/runners?per_page=${PAGE_SIZE}&page=${page}`;
      core.info(`Sending request: ${route}`);
      const response = await octokit.request(route, config.githubContext);
      core.info(
        `Received ${response.data.runners.length} runners from GitHub.`,
      );
      core.info(`Response headers: ${stringify(response.headers)}`);
      runners.push(...response.data.runners);
      done = response.data.runners.length < PAGE_SIZE;
      page++;
    }
    core.info(
      `Got ${runners.length} runners in total from GitHub for this repository.`,
    );
    core.info(`All runners:\n${stringify(runners)}`);
    const foundRunners = _.filter(runners, { labels: [{ name: label }] });
    const ret = foundRunners.length > 0 ? foundRunners[0] : null;
    core.info(`Found result: ${stringify(ret)}`);
    return ret;
  } catch (error) {
    return null;
  }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request(
      'POST /repos/{owner}/{repo}/actions/runners/registration-token',
      config.githubContext,
    );
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

async function removeRunner() {
  const runner = await getRunner(config.input.label);
  const octokit = github.getOctokit(config.input.githubToken);

  // skip the runner removal process if the runner is not found
  if (!runner) {
    core.info(
      `GitHub self-hosted runner with label ${config.input.label} is not found, so the removal is skipped`,
    );
    return;
  }

  try {
    await octokit.request(
      'DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}',
      _.merge(config.githubContext, { runner_id: runner.id }),
    );
    core.info(`GitHub self-hosted runner ${runner.name} is removed`);
    return;
  } catch (error) {
    core.error('GitHub self-hosted runner removal error');
    throw error;
  }
}

async function waitForRunnerRegistered(label) {
  const timeoutMinutes = 5;
  const retryIntervalSeconds = 10;
  const quietPeriodSeconds = 30;
  let waitSeconds = 0;

  core.info(
    `Waiting ${quietPeriodSeconds}s for the AWS EC2 instance to be registered in GitHub as a new self-hosted runner`,
  );
  await new Promise((r) => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(
    `Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runner is registered`,
  );

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const runner = await getRunner(label);

      if (waitSeconds > timeoutMinutes * 60) {
        core.error('GitHub self-hosted runner registration error');
        clearInterval(interval);
        reject(
          `A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance was not able to register itself in GitHub as a new self-hosted runner.`,
        );
      }

      if (runner && runner.status === 'online') {
        core.info(
          `GitHub self-hosted runner ${runner.name} is registered and ready to use`,
        );
        clearInterval(interval);
        resolve();
      } else {
        waitSeconds += retryIntervalSeconds;
        core.info('Checking...');
      }
    }, retryIntervalSeconds * 1000);
  });
}

module.exports = {
  getRegistrationToken,
  removeRunner,
  waitForRunnerRegistered,
};
