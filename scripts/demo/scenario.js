import {
  MENTEE_EMAIL, MENTEE_NAME, ADMIN_EMAIL,
  NEW_MENTEE_EMAIL, NEW_MENTEE_NAME, NEW_MENTEE_EDITED_NAME, NEW_MENTEE_STATEMENT,
  NEW_MENTOR_EMAIL, NEW_MENTOR_NAME, NEW_MENTOR_EDITED_NAME, NEW_MENTOR_MOTIVATION,
  FEEDBACK_TEXT, FEEDBACK_RATING,
} from './fixtures.js'

import {
  login, signOut, goToAdmin, findMentor,
  openMatchPanel, getPartnerName, closeAllPanels,
  openPickDetail, getOpenPanelCount,
  submitFeedback, getFeedbackCount, fillApplication, editProfile,
  verifyPendingBanner, adminApproveApplication,
  adminSearchProfile, adminSwitchTab, adminExpandScores,
  adminExpandProfiles, adminExpandRawPayload, adminSearchFeedback,
  adminSelectCandidates, adminSubmitReview, selectMentor,
  waitForResourcesFolder, verifyResourcesButton,
  pause,
} from './helpers.js'

export default async function runScenario(page) {
  // ── Step 1: New mentee applies ──
  console.log('\n── Step 1: New mentee applies ──')
  await login(page, NEW_MENTEE_EMAIL)
  console.log('  Application form shown')
  await fillApplication(page, { name: NEW_MENTEE_NAME, role: 'mentee', freeText: NEW_MENTEE_STATEMENT })
  await page.waitForTimeout(2000)
  const menteeWelcome = await page.textContent('.page-body h2')
  console.log(`  Dashboard: "${menteeWelcome}"`)
  if (!menteeWelcome.includes(NEW_MENTEE_NAME)) {
    throw new Error(`Expected welcome for ${NEW_MENTEE_NAME}, got: ${menteeWelcome}`)
  }
  const menteeBanner = await verifyPendingBanner(page)
  console.log(`  Pending banner: "${menteeBanner.trim().substring(0, 60)}..."`)
  console.log('  Editing profile...')
  await editProfile(page, { name: NEW_MENTEE_EDITED_NAME })
  await page.waitForTimeout(1000)
  const editedWelcome = await page.textContent('.page-body h2')
  console.log(`  Dashboard after edit: "${editedWelcome}"`)
  if (!editedWelcome.includes(NEW_MENTEE_EDITED_NAME)) {
    throw new Error(`Expected welcome for ${NEW_MENTEE_EDITED_NAME}, got: ${editedWelcome}`)
  }
  await signOut(page)
  console.log('  Signed out.')
  await pause(page)

  // ── Step 2: New mentor applies ──
  console.log('\n── Step 2: New mentor applies ──')
  await login(page, NEW_MENTOR_EMAIL)
  console.log('  Application form shown')
  await fillApplication(page, { name: NEW_MENTOR_NAME, role: 'mentor', freeText: NEW_MENTOR_MOTIVATION })
  await page.waitForTimeout(2000)
  const mentorWelcome = await page.textContent('.page-body h2')
  console.log(`  Dashboard: "${mentorWelcome}"`)
  if (!mentorWelcome.includes(NEW_MENTOR_NAME)) {
    throw new Error(`Expected welcome for ${NEW_MENTOR_NAME}, got: ${mentorWelcome}`)
  }
  const mentorBanner = await verifyPendingBanner(page)
  console.log(`  Pending banner: "${mentorBanner.trim().substring(0, 60)}..."`)
  console.log('  Editing profile...')
  await editProfile(page, { name: NEW_MENTOR_EDITED_NAME })
  await page.waitForTimeout(1000)
  const editedMentorWelcome = await page.textContent('.page-body h2')
  console.log(`  Dashboard after edit: "${editedMentorWelcome}"`)
  if (!editedMentorWelcome.includes(NEW_MENTOR_EDITED_NAME)) {
    throw new Error(`Expected welcome for ${NEW_MENTOR_EDITED_NAME}, got: ${editedMentorWelcome}`)
  }
  await signOut(page)
  console.log('  Signed out.')
  await pause(page)

  // ── Step 2b: Admin approves new applications ──
  console.log('\n── Step 2b: Admin approves new applications ──')
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
  await adminSwitchTab(page, 'Applications')
  await pause(page, 1500)
  console.log('  Approving new mentee...')
  const approveMentee = await adminApproveApplication(page, NEW_MENTEE_EDITED_NAME)
  console.log(`  ${approveMentee}`)
  await pause(page, 1000)
  console.log('  Approving new mentor...')
  const approveMentor = await adminApproveApplication(page, NEW_MENTOR_EDITED_NAME)
  console.log(`  ${approveMentor}`)
  await pause(page, 1000)
  await signOut(page)
  console.log('  Signed out.')
  await pause(page)

  // ── Step 3: Mentee logs in ──
  console.log('\n── Step 3: Mentee logs in ──')
  await login(page, MENTEE_EMAIL)
  console.log(`  Logged in as ${MENTEE_EMAIL}`)
  await pause(page)

  // ── Step 4: Mentee requests a match ──
  console.log('\n── Step 4: Mentee requests a match ──')
  const matchMsg = await findMentor(page)
  console.log(`  Result: ${matchMsg}`)
  if (matchMsg.includes('No mentors')) {
    throw new Error('No mentors available — check sample data and mentor max_capacity')
  }
  await pause(page)

  // ── Step 5: Admin reviews the run ──
  console.log('\n── Step 5: Admin reviews the run ──')
  await signOut(page)
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
  console.log('  Opened admin panel (Pending tab)')
  await pause(page, 1500)

  console.log('  Expanding candidate scores...')
  await adminExpandScores(page)
  await pause(page, 2000)

  console.log('  Viewing submission data...')
  await adminExpandRawPayload(page)
  await pause(page, 3000)

  console.log('  Selecting top 2 candidates...')
  const selected = await adminSelectCandidates(page, 2)
  console.log(`  Selected ${selected} candidates`)
  await pause(page, 1000)

  console.log('  Submitting batch review...')
  const reviewMsg = await adminSubmitReview(page)
  console.log(`  Review result: ${reviewMsg}`)
  await pause(page, 1500)

  // ── Step 6: Mentee compares mentors side by side, then picks ──
  console.log('\n── Step 6: Mentee compares mentors side by side, then picks ──')
  await signOut(page)
  await login(page, MENTEE_EMAIL)
  console.log('  Mentee sees approved candidates')
  await pause(page, 1500)

  console.log('  Opening first mentor detail panel...')
  await openPickDetail(page, 0)
  const panelCount1 = await getOpenPanelCount(page)
  console.log(`  Open panels: ${panelCount1}`)
  await pause(page, 1000)

  if (selected > 1) {
    console.log('  Opening second mentor detail panel...')
    await openPickDetail(page, 1)
    const panelCount2 = await getOpenPanelCount(page)
    console.log(`  Open panels: ${panelCount2} (side by side)`)
    await pause(page, 2000)
  }

  console.log('  Closing panels...')
  await closeAllPanels(page)
  await pause(page, 500)

  console.log('  Selecting a mentor...')
  const selectMsg = await selectMentor(page)
  console.log(`  Selection result: ${selectMsg}`)
  await pause(page)

  // ── Step 7: Mentee views match detail in panel ──
  console.log('\n── Step 7: Mentee views match detail in panel ──')
  await openMatchPanel(page)
  const partnerName = await getPartnerName(page)
  console.log(`  Matched with: ${partnerName}`)
  await pause(page, 2000)

  // Get the match info via API for the mentor step
  const matchInfo = await page.evaluate(async (email) => {
    const res = await fetch(`/api/matches?email=${encodeURIComponent(email)}`, {
      headers: { 'x-user-email': email },
    })
    const data = await res.json()
    const active = data.matches.find(m => m.status === 'ACTIVE')
    return active ? { matchId: active.match_id, mentorEmail: active.mentor_email } : null
  }, MENTEE_EMAIL)

  if (!matchInfo) throw new Error('No active match found')
  console.log(`  Mentor email: ${matchInfo.mentorEmail}`)
  await closeAllPanels(page)

  // ── Step 7b: Shared resources folder ──
  console.log('\n── Step 7b: Shared resources folder ──')
  console.log('  Waiting for resources folder to be created...')
  const folderUrl = await waitForResourcesFolder(page, MENTEE_EMAIL, matchInfo.matchId)
  if (folderUrl) {
    console.log(`  Resources folder: ${folderUrl}`)
    await openMatchPanel(page)
    await page.waitForTimeout(1000)
    const hasButton = await verifyResourcesButton(page)
    console.log(`  "Open Resources Folder" button visible: ${hasButton}`)
    if (hasButton) {
      // Click the button — opens Google Drive in a new tab
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page'),
        page.click('a.btn-primary:has-text("Open Resources Folder")'),
      ])
      console.log(`  Opened Google Drive tab: ${newPage.url()}`)
      await pause(newPage, 3000)
      await newPage.close()
      console.log('  Closed Google Drive tab')
    }
    await closeAllPanels(page)
  } else {
    console.log('  Resources folder not created (Google OAuth may not be configured)')
  }

  // ── Step 8: Mentor views the same match ──
  console.log('\n── Step 8: Mentor views the same match ──')
  await signOut(page)
  await login(page, matchInfo.mentorEmail)
  console.log(`  Logged in as mentor`)
  await pause(page)

  await openMatchPanel(page)
  const menteeName = await getPartnerName(page)
  console.log(`  Mentor sees mentee: ${menteeName}`)
  await pause(page, 2000)
  await closeAllPanels(page)

  // ── Step 9: Mentee submits feedback ──
  console.log('\n── Step 9: Mentee submits feedback ──')
  await signOut(page)
  await login(page, MENTEE_EMAIL)
  await openMatchPanel(page)
  const fbMsg = await submitFeedback(page, FEEDBACK_TEXT, FEEDBACK_RATING)
  console.log(`  Feedback result: ${fbMsg}`)
  const fbCount = await getFeedbackCount(page)
  console.log(`  Feedback items visible: ${fbCount}`)
  await pause(page, 2000)
  await closeAllPanels(page)

  // ── Step 10: Admin inspects in Search tab ──
  console.log('\n── Step 10: Admin inspects in Search tab ──')
  await signOut(page)
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
  await pause(page, 2000)
  await adminSwitchTab(page, 'Search')
  console.log('  Searching mentee profile...')
  await adminSearchProfile(page, MENTEE_EMAIL)
  await pause(page, 1500)

  console.log('  Expanding match scores...')
  await adminExpandScores(page)
  await pause(page, 1500)

  console.log('  Expanding match profiles...')
  await adminExpandProfiles(page)
  await pause(page, 2000)

  console.log('  Viewing submission data...')
  await adminExpandRawPayload(page)
  await pause(page, 3000)

  // Check feedback tab
  console.log('  Checking feedback tab...')
  await adminSwitchTab(page, 'Feedback')
  await pause(page)
  await adminSearchFeedback(page, MENTEE_EMAIL)
  await pause(page, 2000)

  // Check blocks tab
  console.log('  Checking blocks tab...')
  await adminSwitchTab(page, 'Blocks')
  await pause(page, 2000)

  console.log('\n── Demo complete ──')
}
