import { browserstackLauncher } from '@web/test-runner-browserstack';
import { defaultReporter } from '@web/test-runner';
//import { puppeteerLauncher } from '@web/test-runner-puppeteer';
import { visualRegressionPlugin } from '@web/test-runner-visual-regression/plugin';
import percySnapshot from '@percy/puppeteer';
import snowpackWebTestRunner from '@snowpack/web-test-runner-plugin';

// Set NODE_ENV to test to ensure snowpack builds in test mode.
process.env.NODE_ENV = 'test';

/**
 * Test result reporter which supports detailed output of chai/jasmine/etc test
 * results. Inspired by code here:
 * https://github.com/modernweb-dev/web/issues/229#issuecomment-732005741
 */
class SpecReporter {
  constructor() {
    // TODO(https://github.com/eslint/eslint/issues/14343): Change to class field when eslint supports it.
    this.color = {
      reset: '\x1b[0m',
      cyan: '\x1b[36m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      dim: '\x1b[2m',
      yellow: '\x1b[33m',
    };
  }

  /**
   * @param {import('@web/test-runner').TestSuiteResult} suite
   * @param indent
   * @returns
   */
  outputSuite(suite, indent = '') {
    if (suite === undefined) {
      return 'Suite is undefined; top level error';
    }
    let results = `${indent}${suite.name}\n`;
    results +=
      suite.tests
        .map((test) => {
          let result = indent;
          if (test.skipped) {
            result += `${this.color.cyan} - ${test.name}`;
          } else if (test.passed) {
            result += `${this.color.green} ✓ ${this.color.reset}${this.color.dim}${test.name}`;
          } else {
            if (test.error === undefined) {
              test.error = {};
              test.error.message = 'Test failed with no error message';
              test.error.stack = '<no stack trace>';
            }
            result += `${this.color.red} ${test.name}\n\n${test.error.message}\n${test.error.stack}`;
          }
          result +=
            test.duration > 100
              ? ` ${this.color.reset}${this.color.red}(${test.duration}ms)`
              : test.duration > 50
              ? ` ${this.color.reset}${this.color.yellow}(${test.duration}ms)`
              : '';
          result += `${this.color.reset}`;

          return result;
        })
        .join('\n') + '\n';
    if (suite.suites) {
      results += suite.suites
        .map((suite) => this.outputSuite(suite, indent + '  '))
        .join('\n');
    }
    return results;
  }

  /**
   * @param testFile
   * @param {import('@web/test-runner').TestSession[]} sessionsForTestFile
   * @returns
   */
  async generateTestReport(testFile, sessionsForTestFile) {
    let results = '';
    sessionsForTestFile.forEach((session) => {
      if (session.testResults === undefined) {
        return session.status + '\n\n';
      }
      results += session.testResults.suites
        .map((suite) => this.outputSuite(suite, ''))
        .join('\n\n');
    });
    return results;
  }

  specReporter({ reportResults = true } = {}) {
    return {
      onTestRunFinished: () => {},
      reportTestFileResults: async ({
        logger,
        sessionsForTestFile,
        testFile,
      }) => {
        if (!reportResults) {
          return;
        }
        const testReport = await this.generateTestReport(
          testFile,
          sessionsForTestFile
        );
        logger.group();
        console.log(testReport);
        logger.groupEnd();
      },
    };
  }
}

function myPlugin() {
  return {
    name: 'my-plugin',

    async executeCommand({ command, session, payload }) {
      if (command === 'takePercySnapshot') {
        if (session.browser.type === 'puppeteer') {
          /** @type {import('@web/test-runner-chrome').ChromeLauncher} */
          const browser = session.browser;
          const page = browser.getPage(session.id);
          await percySnapshot(page, payload.id);
          return true;
        }
      }
    },
  };
}

const sharedCapabilities = {
  // your username and key for browserstack, you can get this from your browserstack account
  // it's recommended to store these as environment variables
  'browserstack.user': process.env.BROWSER_STACK_USERNAME,
  'browserstack.key': process.env.BROWSER_STACK_ACCESS_KEY,

  project: 'rikaikun',
  name: 'CI Testing',
  // if you are running tests in a CI, the build id might be available as an
  // environment variable. this is useful for identifying test runs
  // this is for example the name for github actions
  build: `build ${process.env.GITHUB_RUN_NUMBER || 'unknown'}`,
  'browserstack.console': 'verbose',
  'browserstack.networkLogs': 'true',
};

/** @type {import('@web/test-runner').TestRunnerConfig} */
export default {
  browserLogs: true,
  browserStartTimeout: 1000 * 60 * 1,
  testsStartTimeout: 1000 * 60 * 1,
  testsFinishTimeout: 1000 * 60 * 3,
  testFramework: {
    config: {
      ui: 'bdd',
      timeout: '2000',
    },
  },
  coverageConfig: {
    exclude: ['**/snowpack/**/*', '**/*.test.ts*'],
  },
  // how many browsers to run concurrently in browserstack. increasing this significantly
  // reduces testing time, but your subscription might limit concurrent connections
  concurrentBrowsers: 2,
  // amount of test files to execute concurrently in a browser. the default value is based
  // on amount of available CPUs locally which is irrelevant when testing remotely
  concurrency: 6,
  browsers: [
    // create a browser launcher per browser you want to test
    // you can get the browser capabilities from the browserstack website
    browserstackLauncher({
      capabilities: {
        ...sharedCapabilities,
        browserName: 'Chrome',
        os: 'Windows',
        os_version: '10',
      },
    }),

    // browserstackLauncher({
    //   capabilities: {
    //     ...sharedCapabilities,
    //     browserName: 'Chrome',
    //     os: 'OS X',
    //     os_version: 'Big Sur',
    //   },
    // }),
  ],
  // browsers: [
  //   puppeteerLauncher({
  //     launchOptions: {
  //       // executablePath: '/usr/bin/google-chrome',
  //       // headless: true,
  //       // disable-gpu required for chrome to run for some reason.
  //       args: ['--remote-debugging-port=9333'],
  //     },
  //   }),
  // ],
  plugins: [
    snowpackWebTestRunner(),
    myPlugin(),
    visualRegressionPlugin({
      update: process.argv.includes('--update-visual-baseline'),
    }),
  ],
  // Use custom runner HTML to add chrome stubs early since chrome APIs are used during
  // file initialization in rikaikun.
  testRunnerHtml: (testFramework) =>
    `<html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      </head>
      <body>
        <script type="module" src="test/chrome_stubs.js"></script>
        <script type="module" src="${testFramework}"></script>
      </body>
    </html>`,
  reporters: [
    // Gives overall test progress across all tests.
    defaultReporter({ reportTestResults: true, reportTestProgress: true }),
    // Gives detailed description of chai test spec results.
    new SpecReporter().specReporter(),
  ],
};
