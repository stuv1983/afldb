import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    console.log('Navigating to /grid-solver...');
    await page.goto('http://localhost:3100/grid-solver', { waitUntil: 'networkidle' });
    
    console.log('Checking board load state...');
    const h1 = await page.locator('h1').innerText();
    if (!h1.includes('Grid solver')) throw new Error('H1 not found');
    console.log('✅ Board loaded successfully');

    // Select row 2 category and question
    const row2Fieldset = page.locator('fieldset:has(legend:text("Row 2"))');
    await row2Fieldset.locator('select').nth(0).selectOption({ label: 'Teammates' });
    await row2Fieldset.locator('select').nth(1).selectOption({ label: 'Teammate of…' });
    
    // Player search
    console.log('Searching for Archie Roberts...');
    const playerInput = row2Fieldset.locator('input[type="text"]').first();
    await playerInput.fill('Archie Roberts');
    
    console.log('Waiting for search suggestion...');
    const suggestion = page.locator('.suggestions button:has-text("Archie Roberts")').first();
    // Use a generic selector for the suggestion in case class is different
    const altSuggestion = page.locator('button:has-text("Archie Roberts")').first();
    await altSuggestion.waitFor({ state: 'visible', timeout: 5000 });
    await altSuggestion.click();
    console.log('✅ Found and selected Archie Roberts');

    console.log('Clicking Solve...');
    await page.locator('button:has-text("Solve")').click();
    await page.waitForURL(/g=/, { waitUntil: 'networkidle' });
    
    console.log('Checking cell 1-2 (Row 2, Col 3)...');
    const cell = page.locator('tbody tr').nth(1).locator('td').nth(2);
    const cellText = await cell.innerText();
    console.log('Cell text:', cellText);
    if (!cellText.includes('No answer')) {
      console.log('❌ Expected No answer in cell text');
    } else {
      console.log('✅ Cell says No answer');
    }
    
    console.log('Clicking cell to view drill down...');
    await cell.locator('a').click();
    
    const drilldownText = await page.locator('.empty h2').innerText();
    console.log('Drilldown text:', drilldownText);
    if (!drilldownText.includes('No answer')) {
      console.log('❌ Expected No answer in drilldown');
    } else {
      console.log('✅ Drilldown says No answer');
    }

  } catch (err) {
    console.error('❌ Error during test:', err);
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
