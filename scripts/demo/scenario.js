import {
  MENTEE_EMAIL, MENTEE_NAME, ADMIN_EMAIL,
  NO_PROFILE_EMAIL, FEEDBACK_TEXT, FEEDBACK_RATING,
} from './fixtures.js'

import {
  login, signOut, goToAdmin, findMentor,
  openMatchPanel, getPartnerName, closeAllPanels,
  openPickDetail, getOpenPanelCount,
  submitFeedback, getFeedbackCount, getApplicationForm,
  adminSearchProfile, adminSwitchTab, adminExpandScores,
  adminExpandProfiles, adminExpandRawPayload, adminSearchFeedback,
  adminSelectCandidates, adminSubmitReview, selectMentor,
  pause,
} from './helpers.js'

export default async function runScenario(page) {
  // ── Step 1: No-profile user sees application form ──
  console.log('\n── Step 1: No-profile user sees application form ──')
  await login(page, NO_PROFILE_EMAIL)
  await getApplicationForm(page)
  console.log('  Application form is shown')
  await signOut(page)
  console.log('  Signed out.')
  await pause(page)

  // ── Step 2: Mentee logs in ──
  console.log('\n── Step 2: Mentee logs in ──')
  await login(page, MENTEE_EMAIL)
  console.log(`  Logged in as ${MENTEE_EMAIL}`)
  await pause(page)

  // ── Step 3: Mentee requests a match ──
  console.log('\n── Step 3: Mentee requests a match ──')
  const matchMsg = await findMentor(page)
  console.log(`  Result: ${matchMsg}`)
  if (matchMsg.includes('No mentors')) {
    throw new Error('No mentors available — check sample data and mentor max_capacity')
  }
  await pause(page)

  // ── Step 4: Admin reviews the run ──
  console.log('\n── Step 4: Admin reviews the run ──')
  await signOut(page)
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
  console.log('  Opened admin panel (Pending tab)')
  await pause(page, 1500)

  console.log('  Expanding candidate scores...')
  await adminExpandScores(page)
  await pause(page, 2000)

  console.log('  Selecting top 2 candidates...')
  const selected = await adminSelectCandidates(page, 2)
  console.log(`  Selected ${selected} candidates`)
  await pause(page, 1000)

  console.log('  Submitting batch review...')
  const reviewMsg = await adminSubmitReview(page)
  console.log(`  Review result: ${reviewMsg}`)
  await pause(page, 1500)

  // ── Step 5: Mentee compares mentors side by side, then picks ──
  console.log('\n── Step 5: Mentee compares mentors side by side, then picks ──')
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

  // ── Step 6: Mentee views match detail in panel ──
  console.log('\n── Step 6: Mentee views match detail in panel ──')
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

  // ── Step 7: Mentor views the same match ──
  console.log('\n── Step 7: Mentor views the same match ──')
  await signOut(page)
  await login(page, matchInfo.mentorEmail)
  console.log(`  Logged in as mentor`)
  await pause(page)

  await openMatchPanel(page)
  const menteeName = await getPartnerName(page)
  console.log(`  Mentor sees mentee: ${menteeName}`)
  await pause(page, 2000)
  await closeAllPanels(page)

  // ── Step 8: Mentee submits feedback ──
  console.log('\n── Step 8: Mentee submits feedback ──')
  await signOut(page)
  await login(page, MENTEE_EMAIL)
  await openMatchPanel(page)
  const fbMsg = await submitFeedback(page, FEEDBACK_TEXT, FEEDBACK_RATING)
  console.log(`  Feedback result: ${fbMsg}`)
  const fbCount = await getFeedbackCount(page)
  console.log(`  Feedback items visible: ${fbCount}`)
  await pause(page, 2000)
  await closeAllPanels(page)

  // ── Step 9: Admin inspects in Search tab ──
  console.log('\n── Step 9: Admin inspects in Search tab ──')
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

  console.log('  Showing raw payload...')
  await adminExpandRawPayload(page)
  await pause(page, 2000)

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
