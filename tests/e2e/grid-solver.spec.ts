import { test, expect } from '@playwright/test';

test('Grid Solver Validation', async ({ page }) => {
  await page.goto('/grid-solver');
  
  // 1. Board loading
  await expect(page.locator('h1')).toHaveText('Grid solver');
  await expect(page.locator('text=9 of 9 squares solved')).toBeVisible();

  // 2. Cell selection
  // Click cell 0-0
  const firstCell = page.locator('tbody tr').nth(0).locator('td').nth(0).locator('a');
  await firstCell.click();
  // Wait for drill down
  await expect(page.locator('h2:has-text("×")')).toBeVisible();

  // 3. Edit Row 2 to Teammates -> Teammate of... -> Archie Roberts
  await page.locator('legend:has-text("Row 2")').locator('..').locator('select').nth(0).selectOption({ label: 'Teammates' });
  await page.locator('legend:has-text("Row 2")').locator('..').locator('select').nth(1).selectOption({ label: 'Teammate of…' });
  
  // Find player input
  const playerInput = page.locator('legend:has-text("Row 2")').locator('..').locator('input[type="search"]').first();
  await playerInput.fill('Archie Roberts');
  
  // Wait for dropdown
  const suggestion = page.locator('li:has-text("Archie Roberts")').first();
  await suggestion.waitFor();
  await suggestion.click();

  // Solve
  await page.locator('button:has-text("Solve")').click();
  await page.waitForURL(/g=/);

  // Check Archie Roberts cell (Row 2, Column 3 - which is 2010s)
  const archieCell = page.locator('tbody tr').nth(1).locator('td').nth(2);
  await expect(archieCell).toContainText('No answer');
  await expect(archieCell).toContainText('0 eligible');

  // Cell selection on the No Answer cell
  await archieCell.locator('a').click();
  await expect(page.locator('.empty h2:has-text("No answer")')).toBeVisible();
});
