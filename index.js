import fs from 'fs';
import { chromium } from 'playwright';
import { parse } from 'csv-parse';
import SpellChecker from 'spellchecker';

(async () => {
  // Launch the browser
  const browser = await chromium.launch();

  // Read the CSV file
  const data = fs.readFileSync('urls.csv', 'utf8');

  // Parse the CSV data
  parse(data, {
    columns: ["title", "url"],
    from_line: 2,
    skip_empty_lines: true,
    trim: true,
  }, async (err, records) => {
    if (err) {
      console.error('Failed to parse CSV:', err);
      return;
    }

    const context = await browser.newContext();

    // Loop through each record in the CSV
    for (const record of records) {
      
      const page = await context.newPage();

      const { title, url } = record;

      console.log(`  - Processing ${title} at ${url}`);
      try {
        // Navigate to the URL
        await page.goto(url);

        // Extract all text content from the page
        const textContent = await page.evaluate(() => {
          // Remove script and style elements
          const scripts = document.querySelectorAll('script, style');
          scripts.forEach(script => script.remove());
          
          // Get text content
          return document.body.innerText;
        });

        // Check spelling
        const missspells = SpellChecker.checkSpelling(textContent)
        for (const misspell of missspells) {
          console.log(`    - ${textContent.substring(misspell.start, misspell.end)}`);
        }
      } catch (error) {
        console.error(`Error capturing screenshot for ${title}: ${error}`);
      }
    }

    // Close the browser
    await browser.close();
  });
})();
