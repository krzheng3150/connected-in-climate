import {
  MENTEE_EMAIL, MENTEE_NAME, ADMIN_EMAIL,
  FEEDBACK_TEXT, FEEDBACK_RATING,
} from './fixtures.js'

import {
  login, signOut, goToAdmin, findMentor, clickFirstMatch,
  getPartnerName, submitFeedback, getFeedbackCount,
  adminSearchProfile, adminSwitchTab, adminExpandScores,
  adminExpandProfiles, adminExpandRawPayload, adminSearchFeedback,
  pause,
} from './helpers.js'

export default async function runScenario(page) {
  console.log('\n── Step 1: Mentee logs in ──')
  await login(page, MENTEE_EMAIL)
  console.log(`  Logged in as ${MENTEE_EMAIL}`)
  await pause(page)

  console.log('\n── Step 2: Mentee finds a mentor ──')
  const matchMsg = await findMentor(page)
  console.log(`  Result: ${matchMsg}`)
  if (matchMsg.includes('No mentors')) {
    throw new Error('No mentors available — check sample data and mentor max_capacity')
  }
  await pause(page)

  console.log('\n── Step 3: Mentee views match detail ──')
  await clickFirstMatch(page)
  const partnerName = await getPartnerName(page)
  console.log(`  Matched with: ${partnerName}`)
  const matchUrl = page.url()
  await pause(page, 2000)

  console.log('\n── Step 4: Mentor views the same match ──')
  // Extract mentor email from the match page URL via the API
  const matchId = matchUrl.split('/matches/')[1]
  const mentorEmail = await page.evaluate(async (id) => {
    const res = await fetch(`/api/admin/matches/${id}`, {
      headers: { 'x-user-email': 'krzheng3150@gmail.com' },
    })
    const data = await res.json()
    return data.mentor_email
  }, matchId)
  console.log(`  Mentor email: ${mentorEmail}`)

  await signOut(page)
  await login(page, mentorEmail)
  console.log(`  Logged in as mentor`)
  await pause(page)

  await clickFirstMatch(page)
  const menteeName = await getPartnerName(page)
  console.log(`  Mentor sees mentee: ${menteeName}`)
  await pause(page, 2000)

  console.log('\n── Step 5: Mentee submits feedback ──')
  await signOut(page)
  await login(page, MENTEE_EMAIL)
  await clickFirstMatch(page)
  const fbMsg = await submitFeedback(page, FEEDBACK_TEXT, FEEDBACK_RATING)
  console.log(`  Feedback result: ${fbMsg}`)
  const fbCount = await getFeedbackCount(page)
  console.log(`  Feedback items visible: ${fbCount}`)
  await pause(page, 2000)

  console.log('\n── Step 6: Admin reviews everything ──')
  await signOut(page)
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
  console.log('  Opened admin panel')
  await pause(page)

  // Search mentee profile
  console.log('  Searching mentee profile...')
  await adminSearchProfile(page, MENTEE_EMAIL)
  await pause(page, 1500)

  // Expand match scores
  console.log('  Expanding match scores...')
  await adminExpandScores(page)
  await pause(page, 2000)

  // Expand mentor/mentee profiles
  console.log('  Expanding match profiles...')
  await adminExpandProfiles(page)
  await pause(page, 2000)

  // Show raw computation payload
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
