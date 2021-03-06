import { EC2, SSM } from 'aws-sdk';

export interface LaunchtemplateInfo {
  LaunchTemplateId: string;
  LaunchTemplateName: string;
  lclabels: string | undefined;
  DefaultVersionNumber: string | undefined;
}

export interface RunnerInfo {
  instanceId: string;
  launchTime: Date | undefined;
  repo: string | undefined;
  org: string | undefined;
}

export interface ListRunnerFilters {
  repoName?: string;
  orgName?: string;
  environment?: string;
}

export interface ListLaunchtemplateFilters {

  environment?: string;
}




export async function getlaunchtemplate(filters: ListLaunchtemplateFilters | undefined = undefined): Promise<LaunchtemplateInfo[]> {
  console.debug('trying to list the launchtemplate');
  const ec2 = new EC2();
    let lcFilters = [
    { Name: 'tag:OSPlatform', Values: ['Windows'] },
 
  ];
  if (filters) {
    if (filters.environment !== undefined) {
      lcFilters.push({ Name: 'tag:Environment', Values: [filters.environment] });
    }
  }
  const thelaunchtemplate = await ec2.describeLaunchTemplates({ Filters: lcFilters }).promise();
  const templates: LaunchtemplateInfo[] = [];
  if (thelaunchtemplate.LaunchTemplates) {
    for (const r of thelaunchtemplate.LaunchTemplates) {
   
          templates.push({
            LaunchTemplateId: r.LaunchTemplateId as string,
            LaunchTemplateName: r.LaunchTemplateName as string,
            lclabels: r.Tags?.find((e) => e.Key === 'labels')?.Value,
            DefaultVersionNumber: r.DefaultVersionNumber?.toString(),
          });
       
    }
  }
  return templates;
}




export async function listRunners(filters: ListRunnerFilters | undefined = undefined): Promise<RunnerInfo[]> {
  const ec2 = new EC2();
  let ec2Filters = [
    { Name: 'tag:Application', Values: ['github-action-runner'] },
    { Name: 'instance-state-name', Values: ['running', 'pending'] },
  ];
  if (filters) {
    if (filters.environment !== undefined) {
      ec2Filters.push({ Name: 'tag:Environment', Values: [filters.environment] });
    }
    if (filters.repoName !== undefined) {
      ec2Filters.push({ Name: 'tag:Repo', Values: [filters.repoName] });
    }
    if (filters.orgName !== undefined) {
      ec2Filters.push({ Name: 'tag:Org', Values: [filters.orgName] });
    }
  }
  const runningInstances = await ec2.describeInstances({ Filters: ec2Filters }).promise();
  const runners: RunnerInfo[] = [];
  if (runningInstances.Reservations) {
    for (const r of runningInstances.Reservations) {
      if (r.Instances) {
        for (const i of r.Instances) {
          runners.push({
            instanceId: i.InstanceId as string,
            launchTime: i.LaunchTime,
            repo: i.Tags?.find((e) => e.Key === 'Repo')?.Value,
            org: i.Tags?.find((e) => e.Key === 'Org')?.Value,
          });
        }
      }
    }
  }
  return runners;
}

export interface RunnerInputParameters {
  runnerConfig: string;
  environment: string;
  repoName?: string;
  orgName?: string;
}

export async function terminateRunner(runner: RunnerInfo): Promise<void> {
  const ec2 = new EC2();
  const result = await ec2
    .terminateInstances({
      InstanceIds: [runner.instanceId],
    })
    .promise();
  console.debug('Runner terminated.' + runner.instanceId);
}




export async function createRunner(runnerParameters: RunnerInputParameters): Promise<void> {
  console.debug('trying to describe the lc');
  const applicablelaunchtemplates = await getlaunchtemplate();
 

  const launchTemplateName = applicablelaunchtemplates[0].LaunchTemplateName;
  const launchTemplateVersion = applicablelaunchtemplates[0].DefaultVersionNumber;

  const subnets = (process.env.SUBNET_IDS as string).split(',');
  const randomSubnet = subnets[Math.floor(Math.random() * subnets.length)];
  console.debug('Runner configuration: ' + JSON.stringify(runnerParameters));
  const ec2 = new EC2();


for (const lt of applicablelaunchtemplates) {
    const runInstancesResponse = await ec2
    .runInstances({
      MaxCount: 1,
      MinCount: 1,
      LaunchTemplate: {
       LaunchTemplateName: lt.LaunchTemplateName as string,
       Version: lt.DefaultVersionNumber as string,
      },
      SubnetId: randomSubnet,
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            { Key: 'Application', Value: 'github-action-runner' },
            {
              Key: runnerParameters.orgName ? 'Org' : 'Repo',
              Value: runnerParameters.orgName ? runnerParameters.orgName : runnerParameters.repoName,
            },
          ],
        },
      ],
    })
    .promise();

console.info('Created instance(s): ', runInstancesResponse.Instances?.map((i) => i.InstanceId).join(','));

  const ssm = new SSM();
  
  runInstancesResponse.Instances?.forEach(async (i: EC2.Instance) => {
    await ssm
      .putParameter({
        Name: runnerParameters.environment + '-' + (i.InstanceId as string),
        Value: runnerParameters.runnerConfig+ ' --labels ' + lt.lclabels,
        Type: 'SecureString',
      })
      .promise();
   });

  }
}

 
  


