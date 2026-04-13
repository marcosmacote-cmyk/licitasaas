import { test, expect } from '@playwright/test';

test.describe('LicitaSaaS - Smoke Tests', () => {
  test('App loads and renders Kanban', async ({ page }) => {
    // Navigate to the root URL
    await page.goto('/');

    // Check if the logo/title exists (adjust selector based on your actual DOM)
    await expect(page.locator('text=LicitaSaaS')).toBeVisible({ timeout: 10000 });

    // Ensure the main Kanban board or side navigation is present
    const boardExists = await page.locator('.kanban-board').isVisible() || await page.locator('.kanban-column').first().isVisible();
    expect(boardExists).toBeTruthy();
  });

  // Future test for Edital Upload Happy Path
  test('Navigation to Nova Licitação works', async ({ page }) => {
    await page.goto('/');
    
    // Find Add Process button and click
    const btn = page.locator('button:has-text("Adicionar Processo")').first();
    if (await btn.isVisible()) {
      await btn.click();
      
      // Modal or page should be visible
      await expect(page.locator('text=Cadastrar Processo')).toBeVisible();
    }
  });

});
