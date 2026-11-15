import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/fullstack',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results/local',
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build -- --mode e2e && dotnet run --project ../src_C/Tests/RecallSmith.Authoring.LocalHost',
    url: 'http://127.0.0.1:5187/__test/ready',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
