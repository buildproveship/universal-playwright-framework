#!/bin/bash

# Universal Playwright Framework Setup Script
# This script helps integrate the framework with any web application

set -e

echo "🎯 Universal Playwright Framework Setup"
echo "======================================="

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: package.json not found. Please run this script from the framework root directory."
    exit 1
fi

# Get project details
echo ""
echo "📋 Let's configure the framework for your project:"
echo ""

read -p "🌐 What's your app's local development URL? (default: http://localhost:3000): " APP_URL
APP_URL=${APP_URL:-http://localhost:3000}

read -p "📱 What's your app name? (default: My App): " APP_NAME
APP_NAME=${APP_NAME:-"My App"}

read -p "🧪 What's your test directory name? (default: my-app): " TEST_DIR
TEST_DIR=${TEST_DIR:-"my-app"}

echo ""
echo "🔧 Setting up framework..."

# Create .env file
echo "Creating .env file..."
cat > .env << EOF
# Environment Configuration
BASE_URL=${APP_URL}
APP_NAME=${APP_NAME}

# Test Configuration
HEADLESS=true
BROWSER=chromium
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=720

# CI Configuration
CI=false
RETRIES=2
WORKERS=1
EOF

# Create app-specific test directory
echo "Creating test directory for your app..."
mkdir -p "tests/${TEST_DIR}"
mkdir -p "tests/${TEST_DIR}/pages"
mkdir -p "tests/${TEST_DIR}/fixtures"

# Create sample page object
cat > "tests/${TEST_DIR}/pages/home-page.ts" << EOF
import { BasePage } from '../../src/pages/base-page';
import { Page } from '@playwright/test';

export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page, '/');
  }

  async getWelcomeMessage(): Promise<string> {
    // 👇 Update this selector to match your app
    return await this.getElementText('[data-testid="welcome-message"]');
  }

  async clickGetStartedButton(): Promise<void> {
    // 👇 Update this selector to match your app  
    await this.clickElement('[data-testid="get-started-btn"]');
  }

  async isLoaded(): Promise<boolean> {
    // 👇 Update this to check if your page is loaded
    return await this.isElementVisible('[data-testid="main-content"]');
  }
}
EOF

# Create sample test data
cat > "tests/${TEST_DIR}/fixtures/test-data.ts" << EOF
import { TestDataFactory } from '../../fixtures/test-data-factory';

export class ${APP_NAME//[^a-zA-Z0-9]/_}TestData extends TestDataFactory {
  static generateUser(userType: string = 'standard') {
    const baseUser = super.generateUser(userType);
    
    return {
      ...baseUser,
      // Add your app-specific user data here
      preferences: {
        notifications: true,
        theme: 'light'
      }
    };
  }

  // Add more app-specific data generators here
  static generateProduct() {
    return {
      id: this.generateId(),
      name: this.generateRandomString(10),
      price: Math.floor(Math.random() * 1000) + 10,
      category: 'electronics'
    };
  }
}
EOF

# Create sample test file
cat > "tests/${TEST_DIR}/home.spec.ts" << EOF
import { test, expect } from '@playwright/test';
import { HomePage } from './pages/home-page';
import { ${APP_NAME//[^a-zA-Z0-9]/_}TestData } from './fixtures/test-data';

test.describe('${APP_NAME} - Homepage', () => {
  test('should load homepage correctly', async ({ page }) => {
    const homePage = new HomePage(page);
    
    await homePage.goto();
    
    // Wait for page to load
    const isLoaded = await homePage.isLoaded();
    expect(isLoaded).toBe(true);
    
    // Check page title
    await expect(page).toHaveTitle(/${APP_NAME}/);
  });

  test('should handle user interactions', async ({ page }) => {
    const homePage = new HomePage(page);
    const userData = ${APP_NAME//[^a-zA-Z0-9]/_}TestData.generateUser();
    
    await homePage.goto();
    
    // Example interaction - customize for your app
    if (await page.locator('[data-testid="get-started-btn"]').isVisible()) {
      await homePage.clickGetStartedButton();
      
      // Add assertions based on your app's behavior
      // Example: await expect(page).toHaveURL('/onboarding');
    }
    
    console.log('Generated test user:', userData.email);
  });
});

/**
 * 🚀 QUICK CUSTOMIZATION GUIDE:
 * 
 * 1. Update selectors in home-page.ts to match your app
 * 2. Modify test-data.ts to generate data for your app
 * 3. Add more test scenarios in this file
 * 4. Create additional page objects for other pages
 * 5. Run tests: npm run test tests/${TEST_DIR}/
 * 
 * 📖 See docs/ folder for comprehensive guides
 */
EOF

# Update playwright config for the new app
cat > playwright.config.ts << EOF
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// Load environment variables
config();

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? parseInt(process.env.RETRIES || '2') : 0,
  workers: process.env.CI ? parseInt(process.env.WORKERS || '1') : undefined,
  
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results.json' }],
    ['junit', { outputFile: 'test-results.xml' }]
  ],
  
  use: {
    baseURL: process.env.BASE_URL || '${APP_URL}',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.HEADLESS !== 'false',
  },

  projects: [
    {
      name: '${TEST_DIR}-chromium',
      testDir: './tests/${TEST_DIR}',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: '${TEST_DIR}-firefox',
      testDir: './tests/${TEST_DIR}',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: '${TEST_DIR}-webkit',
      testDir: './tests/${TEST_DIR}',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: '${TEST_DIR}-mobile',
      testDir: './tests/${TEST_DIR}',
      use: { ...devices['iPhone 12'] },
    },
  ],
});
EOF

# Install dependencies
echo "Installing dependencies..."
# Dependency lifecycle scripts stay disabled; the reviewed framework build runs explicitly.
npm install --ignore-scripts

# Replace the package prepare hook without enabling dependency lifecycle scripts.
echo "Building TypeScript..."
npm run --ignore-scripts build

# Install browsers
echo "Installing Playwright browsers..."
# Use only the exact Playwright version installed from package.json/package-lock.json.
# Do not fall back to npx or a global CLI when the local installation is incomplete.
if [[ ! -f "./node_modules/@playwright/test/cli.js" ]]; then
    echo "❌ Local Playwright CLI is missing. Reinstall the framework dependencies before installing browsers." >&2
    exit 1
fi
node ./node_modules/@playwright/test/cli.js install

echo ""
echo "✅ Setup Complete!"
echo ""
echo "🎯 Your framework is ready for ${APP_NAME}!"
echo ""
echo "📁 Files created:"
echo "   • .env (environment configuration)"
echo "   • tests/${TEST_DIR}/ (your app-specific tests)"
echo "   • playwright.config.ts (updated configuration)"
echo ""
echo "🚀 Quick start commands:"
echo "   • npm run test tests/${TEST_DIR}/           # Run your app tests"
echo "   • npm run test:headed tests/${TEST_DIR}/    # Run with browser visible"
echo "   • npm run test:ui tests/${TEST_DIR}/        # Run with Playwright UI"
echo ""
echo "📝 Next steps:"
echo "   1. Update selectors in tests/${TEST_DIR}/pages/home-page.ts"
echo "   2. Customize test data in tests/${TEST_DIR}/fixtures/test-data.ts"
echo "   3. Add more tests in tests/${TEST_DIR}/"
echo "   4. See docs/integration-guide.md for detailed examples"
echo ""
echo "Happy testing! 🧪✨"
