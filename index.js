import fs from 'fs/promises';
import { chromium } from 'playwright';
import { parse } from 'csv-parse/sync';
import SpellChecker from 'spellchecker';

async function processUrl(page, record) {
  const { title, url } = record;

  try {
    // Set timeout and other options for better performance
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Extract all text content from the page
    const textContent = await page.evaluate(() => {
      // Remove script and style elements
      const scripts = document.querySelectorAll('script, style');
      scripts.forEach(script => script.remove());

      // Get text content
      return document.body.innerText;
    });

    const misspellings = SpellChecker.checkSpelling(textContent);

    const uniqueMisspellings = new Map();
    misspellings.forEach(({ start, end }) => {
      const word = textContent.substring(start, end);
      const context = textContent.substring(
        Math.max(0, start - 30),
        Math.min(textContent.length, end + 30)
      ).replace(/\s+/g, ' ').trim();

      if (!uniqueMisspellings.has(word)) {
        uniqueMisspellings.set(word, []);
      }
      uniqueMisspellings.get(word).push(context);
    });

    return {
      pageTitle: title,
      url,
      misspellingCount: uniqueMisspellings.size,
      misspellings: Object.fromEntries(
        Array.from(uniqueMisspellings.entries())
      )
    };
  } catch (error) {
    console.error(`Error processing ${title}: ${error.message}`);
    return 0;
  }
}

async function main() {
  let browser;
  try {
    // Read and parse CSV file
    const data = await fs.readFile('urls.csv', 'utf8');
    const records = parse(data, {
      columns: ["title", "url"],
      from_line: 2,
      skip_empty_lines: true,
      trim: true,
    });

    // Launch browser with optimized settings
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });

    // Create a persistent context
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });

    // Process URLs in parallel with controlled concurrency
    const BATCH_SIZE = 5;
    const results = [];

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const pages = await Promise.all(
        batch.map(() => context.newPage())
      );

      const batchResults = await Promise.all(
        batch.map((record, index) => processUrl(pages[index], record))
      );

      results.push(...batchResults);

      // Close pages after batch processing
      await Promise.all(pages.map(page => page.close()));
    }

    // Generate and save detailed report
    let totalMisspellings = 0;
    const uniqueMisspellings = new Map();

    results.forEach(result => {
      Object.entries(result.misspellings).forEach(([word, contexts]) => {
        totalMisspellings += contexts.length; // Count all instances
        if (!uniqueMisspellings.has(word)) {
          uniqueMisspellings.set(word, new Map());
        }
        uniqueMisspellings.get(word).set(result.url, contexts);
      });
    });

    results.forEach(result => {
      Object.entries(result.misspellings).forEach(([word, contexts]) => {
        if (!uniqueMisspellings.has(word)) {
          uniqueMisspellings.set(word, new Map());
        }
        uniqueMisspellings.get(word).set(result.url, contexts);
      });
    });

    // Print summary report
    console.log('\n=== SPELLING CHECK REPORT ===');
    console.log(`\nProcessed ${records.length} URLs`);
    console.log(`Found ${totalMisspellings} total spelling errors`);
    console.log(`${uniqueMisspellings.size} unique misspelled words\n`);

    // Print misspellings across all pages
    console.log('Misspellings:');
    const sortedMisspellings = Array.from(uniqueMisspellings.entries())
      .sort((a, b) => b[1].size - a[1].size);

    sortedMisspellings.forEach(([word, pages]) => {
      console.log(`\n"${word}" (found on ${pages.size} pages):`);
      pages.forEach((contexts, url) => {
        console.log(`  ${url}:`);
        contexts.forEach(context => {
          const highlighted = context.replace(
            new RegExp(word, 'g'),
            `\x1b[31m${word}\x1b[0m` // Red highlighting for the misspelled word
          );
          console.log(`      Context: "...${highlighted}..."`);
        });
      });
    });

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the program
main().catch(console.error);
