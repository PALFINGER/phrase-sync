// start script like this
//
//   node scripts\phraseapp_integration.js
//     --phraseappToken MY_PHRASEAPP_TOKEN
//     --phraseappProjectId MY_PHRASEAPP_PROJECT_ID
//     --defaultLocale en
//     --localePath ./apps/paldesk/src/assets/i18n
//     --azureToken MY_AZURE_TOKEN
//     --azureProjectId MY_AZURE_PROJECT_ID
//     --azureRepositoryId MY_AZURE_REPOSITORY_ID
//     --azureApproverId MY_AZURE_APPROVER_ID
//     --phraseAppSyncDirection [pull|push]
//     --removeUnmentionedKeys [true|false]
//

// YOU NEED TO COMPILE this FILE first with tsc phraseapp_integration.ts or tsc --watch

// tslint:disable:no-console
import * as azdev from 'azure-devops-node-api';
import * as azdevGitApi from 'azure-devops-node-api/GitApi';
import { IdentityRef } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {
  GitPullRequest,
  GitPullRequestMergeStrategy,
  IdentityRefWithVote,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import * as fs from 'fs';
import { getArgument } from './utils';
import { PhraseClient, PhraseLocale } from './phrase-client';
import simpleGit = require('simple-git/promise');

const token = process.env.SYSTEM_ACCESSTOKEN || getArgument('--azureToken');
const phraseappToken =
  process.env.PHRASEAPP_TOKEN || getArgument('--phraseappToken');

const azureDevopsUri =
  process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ||
  getArgument('--azureDevopsUri');
const azureProjectId =
  process.env.SYSTEM_TEAMPROJECTID || getArgument('--azureProjectId');
const azureRepositoryId =
  process.env.BUILD_REPOSITORY_ID || getArgument('--azureRepositoryId');

// push or pull
const phraseAppSyncDirection =
  process.env.PHRASE_SYNC_DIRECTION || getArgument('--phraseAppSyncDirection');

const gitUserMail =
  process.env.GIT_USER_MAIL ||
  getArgument('--gitUserMail') ||
  'phrase@devops.com';
const gitUserName =
  process.env.GIT_USER_NAME || getArgument('--gitUserName') || 'Phrase Devops';

const removeUnmentionedKeys =
  (
    process.env.REMOVE_UNMENTIONED_KEYS ||
    getArgument('--removeUnmentionedKeys')
  )?.toLowerCase() === 'true';

const authHandler = azdev.getPersonalAccessTokenHandler(token);
const connectionOrgLevel = new azdev.WebApi(azureDevopsUri, authHandler, {});
const phraseappBaseUri = 'https://api.phraseapp.com/api/v2';

const git = simpleGit();
async function pushBranch(branchName: string) {
  await git.addConfig('user.email', gitUserMail);
  await git.addConfig('user.name', gitUserName);

  await git.add('*.json');
  await git.commit('Update PhraseApp translations');
  await git.checkoutLocalBranch(branchName);
  await git.push('origin', branchName, { '--set-upstream': null });
}

interface PhraseProjectRoot {
  projects: PhraseProject[];
}

interface PhraseProject {
  name: string;
  project_id: string;
  locale_path: string;
  default_locale: string;
}

async function createPullRequestForBranch(branchName: string) {
  const gitApiObj: azdevGitApi.GitApi = await connectionOrgLevel.getGitApi();
  const prCreateBody: GitPullRequest = {
    sourceRefName: 'refs/heads/' + branchName,
    targetRefName: 'refs/heads/master',
    title: 'chore(phrase): automatic update of i18n files',
    description: 'Automatic PhraseApp Update',
  };
  console.log('Base Url: ' + gitApiObj.baseUrl);
  const pullRequest = await gitApiObj.createPullRequest(
    prCreateBody,
    azureRepositoryId,
    azureProjectId,
    false,
  );

  console.log('PullRequest Created ' + pullRequest.pullRequestId);

  const identity = pullRequest.createdBy.id;

  const identityRef = <IdentityRef>{
    id: pullRequest.createdBy.id,
  };

  const prUpdateBody: GitPullRequest = {
    autoCompleteSetBy: identityRef,
    completionOptions: {
      deleteSourceBranch: true,
      mergeStrategy: GitPullRequestMergeStrategy.Squash,
    },
  };

  await gitApiObj.updatePullRequest(
    prUpdateBody,
    azureRepositoryId,
    pullRequest.pullRequestId,
  );

  console.log('Pull Request Completed by ' + identity);

  const prVotes = <IdentityRefWithVote>{
    id: identity,
    vote: 10, // approved
  };

  await gitApiObj.createPullRequestReviewer(
    prVotes,
    azureRepositoryId,
    pullRequest.pullRequestId,
    identity,
  );

  console.log('Pull Request approved by ' + identity);
}

async function uploadDefaultLocaleToPhrase(
  phraseAppClient: PhraseClient,
  project: PhraseProject,
  defaultLocale: PhraseLocale,
) {
  const uploadId = await phraseAppClient.uploadLocale(
    defaultLocale.id,
    project.locale_path,
    project.default_locale,
    project.project_id,
  );

  console.log('Initiated upload. UploadId: ' + uploadId);

  if (removeUnmentionedKeys) {
    phraseAppClient.removeUnmentionedKeys(project.project_id, uploadId);
  }
}

async function downloadLocales(
  phraseAppClient: PhraseClient,
  projectLocales: PhraseLocale[],
  project: PhraseProject,
) {
  for (const locale of projectLocales) {
    const fileContent = <any>await phraseAppClient.downloadLocale(
      locale.id,
      project.project_id,
    );
    fs.writeFileSync(
      project.locale_path + '/' + locale.name + '.json',
      fileContent,
    );
  }
}

async function runTasks() {
  const phraseConfig = fs.readFileSync('phrase.json', 'utf-8');
  const phraseProjects: PhraseProjectRoot = JSON.parse(phraseConfig);
  if (!phraseProjects || phraseProjects.projects.length === 0) {
    throw new Error('No phrase config found in root folder');
  }
  const phraseClient = new PhraseClient(phraseappToken, phraseappBaseUri);
  console.log('Found ' + phraseProjects.projects.length + ' projects');
  for (let i = 0; i < 1; i++) {
    const project = phraseProjects.projects[i];
    const localeList = await phraseClient.fetchLocales(project.project_id);
    const defaultLocale = localeList.find(
      (locale) => locale.name === project.default_locale,
    );
    if (defaultLocale) {
      if (phraseAppSyncDirection === 'push') {
        console.log('Push translation updates for project: ' + project.name);
        await uploadDefaultLocaleToPhrase(phraseClient, project, defaultLocale);
      } else if (phraseAppSyncDirection === 'pull') {
        console.log('Pull translation updates for project: ' + project.name);
        await downloadLocales(phraseClient, localeList, project);
      }
    } else {
      throw new Error(
        'DefaultLocale not found for project ' +
          project.name +
          ". List of locales fetched from Phrase didn't contain locale with name " +
          project.default_locale,
      );
    }
  }

  if (phraseAppSyncDirection === 'pull') {
    const gitStatusResult = await git.status();
    if (gitStatusResult.files.length > 0) {
      const branchName = 'chore/phrase/update_i18n';
      await pushBranch(branchName);
      await createPullRequestForBranch(branchName);
    }
  }
}

runTasks();
