// Content script for scraping LinkedIn profiles
// This runs on linkedin.com/in/* pages

console.log('Lattice LinkedIn Helper: Content script loaded');

// Listen for scrape requests from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrape') {
    console.log('Lattice LinkedIn Helper: Starting scrape...');

    try {
      const data = scrapeProfile();
      console.log('Lattice LinkedIn Helper: Scraped data:', data);
      sendResponse({ success: true, data });
    } catch (error) {
      console.error('Lattice LinkedIn Helper: Scrape error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});

function scrapeProfile() {
  const data = {
    about: null,
    education: [],
    scrapedAt: new Date().toISOString()
  };

  // Scrape About section
  data.about = scrapeAboutSection();

  // Scrape Education section with activities/organizations
  data.education = scrapeEducationSection();

  return data;
}

function scrapeAboutSection() {
  // LinkedIn's About section has various selectors depending on the page version
  const aboutSelectors = [
    // Main about section
    'section.pv-about-section div.pv-shared-text-with-see-more span.visually-hidden',
    'section[data-section="summary"] div.display-flex span[aria-hidden="true"]',
    '#about ~ div.display-flex span[aria-hidden="true"]',
    'div[data-generated-suggestion-target*="about"] span[aria-hidden="true"]',
    // Newer LinkedIn layout
    '[data-section="about"] .full-width span[aria-hidden="true"]',
    'section:has(#about) .full-width span[aria-hidden="true"]',
    // Try more generic approaches
    '#about + .pvs-list__container span[aria-hidden="true"]',
    '#about + .display-flex span[aria-hidden="true"]'
  ];

  for (const selector of aboutSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    } catch (e) {
      // Selector didn't match, try next
    }
  }

  // Fallback: look for about section by heading text
  const allSections = document.querySelectorAll('section');
  for (const section of allSections) {
    const heading = section.querySelector('h2, [class*="header"]');
    if (heading && heading.textContent.toLowerCase().includes('about')) {
      const textContent = section.querySelector('span[aria-hidden="true"], .pv-shared-text-with-see-more span');
      if (textContent) {
        return textContent.textContent.trim();
      }
    }
  }

  // Final fallback: try to find the about section by ID
  const aboutSection = document.getElementById('about');
  if (aboutSection) {
    const parent = aboutSection.closest('section');
    if (parent) {
      const spans = parent.querySelectorAll('span[aria-hidden="true"]');
      for (const span of spans) {
        const text = span.textContent.trim();
        // About sections are usually longer
        if (text.length > 50) {
          return text;
        }
      }
    }
  }

  return null;
}

function scrapeEducationSection() {
  const education = [];

  // Find the education section
  const educationSection = document.getElementById('education');
  if (!educationSection) {
    return education;
  }

  const section = educationSection.closest('section');
  if (!section) {
    return education;
  }

  // Find all education entries
  const educationItems = section.querySelectorAll('li.pvs-list__paged-list-item, li[class*="artdeco-list__item"]');

  for (const item of educationItems) {
    const eduEntry = {
      school: null,
      degree: null,
      field: null,
      dates: null,
      activities: null,
      description: null
    };

    // School name - usually the first bold/strong text or in a specific span
    const schoolElement = item.querySelector(
      'span[aria-hidden="true"] > span.hoverable-link-text, ' +
      'a[data-field="education_school_name"] span[aria-hidden="true"], ' +
      '.pvs-entity__title span[aria-hidden="true"], ' +
      'div.display-flex.align-items-center span[aria-hidden="true"]:first-child'
    );
    if (schoolElement) {
      eduEntry.school = schoolElement.textContent.trim();
    }

    // Get all text spans in this item
    const allSpans = item.querySelectorAll('span[aria-hidden="true"]');
    const texts = [];
    for (const span of allSpans) {
      const text = span.textContent.trim();
      if (text && text.length > 1 && !text.includes('·')) {
        texts.push(text);
      }
    }

    // Try to identify degree, field, dates, activities from the texts
    for (const text of texts) {
      if (!eduEntry.school && texts.indexOf(text) === 0) {
        eduEntry.school = text;
      } else if (text.match(/bachelor|master|phd|doctor|associate|b\.s\.|m\.s\.|b\.a\.|m\.a\./i)) {
        eduEntry.degree = text;
      } else if (text.match(/\d{4}\s*[-–]\s*(\d{4}|present)/i)) {
        eduEntry.dates = text;
      } else if (text.toLowerCase().includes('activities') ||
                 text.toLowerCase().includes('societies') ||
                 text.toLowerCase().includes('clubs') ||
                 text.toLowerCase().includes('organizations') ||
                 text.length > 100) {
        // Activities or descriptions tend to be longer
        if (text.toLowerCase().startsWith('activities')) {
          eduEntry.activities = text;
        } else if (!eduEntry.description && text.length > 50) {
          eduEntry.description = text;
        }
      } else if (text.match(/computer|engineering|business|science|arts|economics|finance|marketing/i) && !eduEntry.field) {
        eduEntry.field = text;
      }
    }

    // Look specifically for activities and societies section
    const activitiesElement = item.querySelector('[class*="activities"], [data-field="education_activities"]');
    if (activitiesElement) {
      eduEntry.activities = activitiesElement.textContent.trim();
    }

    // Only add if we found at least a school name
    if (eduEntry.school) {
      education.push(eduEntry);
    }
  }

  return education;
}

// Inject a marker so the web app can detect the extension is installed
document.documentElement.setAttribute('data-lattice-extension', 'true');

// Also set it on window load in case the attribute gets removed
window.addEventListener('load', () => {
  document.documentElement.setAttribute('data-lattice-extension', 'true');
});
