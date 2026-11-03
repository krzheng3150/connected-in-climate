import { BASE_URL } from './fixtures.js'

// ── Navigation ─────────────────────────────────────────────────────

export async function login(page, email) {
  await page.goto(BASE_URL)
  await page.fill('input[type="email"]', email)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard')
}

export async function signOut(page) {
  await page.goto(BASE_URL + '/dashboard')
  await page.click('button:has-text("Sign out")')
  await page.waitForURL(BASE_URL + '/')
}

export async function goToAdmin(page) {
  await page.click('button:has-text("Admin")')
  await page.waitForURL('**/admin')
}

// ── Mentee Actions ─────────────────────────────────────────────────

export async function findMentor(page) {
  await page.click('button:has-text("Find a Mentor")')
  await page.waitForSelector('.dashboard-message')
  const msg = await page.textContent('.dashboard-message')
  return msg
}

export async function clickFirstMatch(page) {
  await page.click('.match-card a, .match-card')
  await page.waitForURL('**/matches/**')
}

export async function getPartnerName(page) {
  return page.textContent('.partner-header h2')
}

// ── Feedback ───────────────────────────────────────────────────────

export async function submitFeedback(page, text, rating) {
  await page.fill('.feedback-form textarea', text)
  if (rating) {
    await page.selectOption('.feedback-form select', rating)
  }
  await page.click('.feedback-form button[type="submit"]')
  await page.waitForSelector('.feedback-msg')
  return page.textContent('.feedback-msg')
}

export async function getFeedbackCount(page) {
  const items = await page.$$('.feedback-item')
  return items.length
}

// ── Admin Actions ──────────────────────────────────────────────────

export async function adminSearchProfile(page, email) {
  await page.fill('.admin-search-form input[type="email"]', email)
  await page.click('.admin-search-form button[type="submit"]')
  await page.waitForSelector('.admin-card')
}

export async function adminSwitchTab(page, tabName) {
  await page.click(`.role-tab:has-text("${tabName}")`)
}

export async function adminExpandScores(page) {
  await page.click('button:has-text("Show scores")')
  await page.waitForSelector('.admin-scores')
}

export async function adminExpandProfiles(page) {
  await page.click('button:has-text("Show profiles")')
  await page.waitForSelector('.admin-match-profiles')
}

export async function adminExpandRawPayload(page) {
  await page.click('button:has-text("Show raw payload")')
  await page.waitForSelector('.admin-json')
}

export async function adminApprovePendingMatches(page, count = 1) {
  let approved = 0
  for (let i = 0; i < count; i++) {
    const btn = await page.$('button:has-text("Approve")')
    if (!btn) break
    await btn.click()
    await page.waitForTimeout(1000)
    approved++
  }
  return approved
}

export async function adminRejectPendingMatch(page) {
  const btn = await page.$('button:has-text("Reject")')
  if (btn) {
    await btn.click()
    await page.waitForTimeout(500)
  }
}

export async function selectMentor(page) {
  await page.click('button:has-text("Select This Mentor")')
  await page.waitForSelector('.dashboard-message')
  return page.textContent('.dashboard-message')
}

export async function adminSearchFeedback(page, email) {
  await page.fill('.admin-search-form input[type="email"]', email)
  await page.click('.admin-search-form button[type="submit"]')
  await page.waitForTimeout(1000)
}

// ── Utilities ──────────────────────────────────────────────────────

export async function pause(page, ms = 1000) {
  await page.waitForTimeout(ms)
}

export async function screenshot(page, name) {
  await page.screenshot({ path: `scripts/demo/screenshots/${name}.png`, fullPage: true })
}
