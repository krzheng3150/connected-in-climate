import { BASE_URL } from './fixtures.js'

// ── Navigation ─────────────────────────────────────────────────────

let activeRouteHandler = null

export async function login(page, email) {
  if (activeRouteHandler) {
    await page.unroute('**/api/**', activeRouteHandler)
  }
  activeRouteHandler = (route) => {
    const headers = { ...route.request().headers(), 'x-user-email': email }
    route.continue({ headers })
  }
  await page.route('**/api/**', activeRouteHandler)
  await page.goto(BASE_URL + '/dashboard')
  await page.waitForSelector('.page-header, .page-body', { timeout: 10000 })
}

export async function signOut(page) {
  if (activeRouteHandler) {
    await page.unroute('**/api/**', activeRouteHandler)
    activeRouteHandler = null
  }
  await page.goto(BASE_URL + '/')
}

export async function goToAdmin(page) {
  await page.click('button:has-text("Admin")')
  await page.waitForURL('**/admin')
  await page.waitForSelector('.role-tab', { timeout: 10000 })
}

// ── Application form ──────────────────────────────────────────────

function reactClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, selector)
}

function reactClickNth(page, selector, index) {
  return page.evaluate(({ sel, idx }) => {
    const els = document.querySelectorAll(sel)
    if (els[idx]) els[idx].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, { sel: selector, idx: index })
}

export async function fillApplication(page, { name, role, freeText }) {
  await page.waitForSelector('.application-form', { timeout: 10000 })
  const roleIndex = role === 'mentor' ? 1 : 0

  // Step 0: select role
  await reactClickNth(page, '.role-option', roleIndex)
  await page.waitForTimeout(2500)
  await reactClick(page, '.btn-primary')
  await page.waitForSelector('input[placeholder="Your full name"]', { timeout: 5000 })

  // Step 1: basic info — fill name, then reveal each dropdown
  await page.fill('input[placeholder="Your full name"]', name)
  await page.waitForTimeout(1000)
  const selects = await page.$$('.form-group select')
  for (const sel of selects) {
    await sel.click()
    await page.waitForTimeout(1500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(1000)
  await reactClickNth(page, '.form-actions button', 1)
  await page.waitForSelector('.checkbox-grid', { timeout: 5000 })

  // Step 2: select a few interests
  await reactClickNth(page, '.checkbox-option input', 0)
  await reactClickNth(page, '.checkbox-option input', 2)
  await reactClickNth(page, '.checkbox-option input', 4)
  await page.waitForTimeout(2500)
  await reactClickNth(page, '.form-actions button', 1)
  await page.waitForSelector('textarea', { timeout: 5000 })

  // Step 3: free text + submit
  await page.fill('textarea', freeText)
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.form-actions button')
    for (const b of btns) {
      if (b.textContent.includes('Submit')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return
      }
    }
  })

  // Wait for form to disappear and dashboard to load
  await page.waitForSelector('.application-form', { state: 'hidden', timeout: 15000 })
}

export async function editProfile(page, { name }) {
  // Click "Edit Profile"
  await page.evaluate(() => {
    const links = document.querySelectorAll('.btn-link')
    for (const l of links) {
      if (l.textContent.includes('Edit Profile')) {
        l.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return
      }
    }
  })
  await page.waitForSelector('.application-form', { timeout: 5000 })
  await page.waitForTimeout(1500)

  // Step 1 (edit skips role selection): update name
  const nameInput = await page.$('input[placeholder="Your full name"]')
  await nameInput.fill('')
  await nameInput.fill(name)
  await page.waitForTimeout(1500)
  await reactClickNth(page, '.form-actions button', 1)
  await page.waitForSelector('.checkbox-grid', { timeout: 5000 })

  // Step 2: leave interests as-is, advance
  await page.waitForTimeout(1500)
  await reactClickNth(page, '.form-actions button', 1)
  await page.waitForSelector('textarea', { timeout: 5000 })

  // Step 3: click Save Changes
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.form-actions button')
    for (const b of btns) {
      if (b.textContent.includes('Save')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return
      }
    }
  })

  await page.waitForSelector('.application-form', { state: 'hidden', timeout: 15000 })
}

// ── Mentee Actions ─────────────────────────────────────────────────

export async function findMentor(page) {
  await page.click('button:has-text("Find a Mentor")')
  await page.waitForSelector('.dashboard-message')
  return page.textContent('.dashboard-message')
}

export async function openMatchPanel(page) {
  await page.click('.match-card')
  await page.waitForSelector('.detail-panel')
}

export async function getPartnerName(page) {
  return page.textContent('.detail-panel .partner-header h2')
}

export async function closePanel(page, index = 0) {
  const closeBtns = await page.$$('.detail-panel-close')
  if (closeBtns[index]) await closeBtns[index].click()
  await page.waitForTimeout(300)
}

export async function closeAllPanels(page) {
  while (await page.$('.detail-panel-close')) {
    await page.click('.detail-panel-close')
    await page.waitForTimeout(200)
  }
}

export async function openPickDetail(page, index = 0) {
  const btns = await page.$$('.admin-card-actions .btn-link')
  if (btns[index]) await btns[index].click()
  await page.waitForTimeout(500)
}

export async function getOpenPanelCount(page) {
  const panels = await page.$$('.detail-panel')
  return panels.length
}

// ── Feedback ───────────────────────────────────────────────────────

export async function submitFeedback(page, text, rating) {
  await page.fill('.detail-panel .feedback-form textarea', text)
  if (rating) {
    await page.selectOption('.detail-panel .feedback-form select', rating)
  }
  await page.click('.detail-panel .feedback-form button[type="submit"]')
  await page.waitForSelector('.detail-panel .feedback-msg')
  return page.textContent('.detail-panel .feedback-msg')
}

export async function getFeedbackCount(page) {
  const items = await page.$$('.detail-panel .feedback-item')
  return items.length
}

// ── Admin Actions ──────────────────────────────────────────────────

export async function adminSearchProfile(page, email) {
  await page.fill('.admin-search-form input[type="email"]', email)
  await page.click('.admin-search-form button[type="submit"]')
  await page.waitForSelector('.admin-card', { timeout: 10000 })
}

export async function adminSwitchTab(page, tabName) {
  await page.waitForSelector('.role-tab', { timeout: 10000 })
  await page.evaluate((name) => {
    const tabs = document.querySelectorAll('.role-tab')
    for (const tab of tabs) {
      if (tab.textContent.trim() === name) {
        tab.click()
        return
      }
    }
  }, tabName)
  await page.waitForTimeout(500)
}

export async function adminExpandScores(page) {
  await page.waitForSelector('button:has-text("Show scores")', { timeout: 10000 })
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

export async function adminSelectCandidates(page, count = 1) {
  const checkboxes = await page.$$('.admin-card input[type="checkbox"]')
  let selected = 0
  for (let i = 0; i < Math.min(count, checkboxes.length); i++) {
    await checkboxes[i].click()
    selected++
  }
  return selected
}

export async function adminSubmitReview(page) {
  await page.click('button:has-text("Submit Review")')
  await page.waitForSelector('.feedback-msg')
  return page.textContent('.feedback-msg')
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
