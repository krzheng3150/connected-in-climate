import {
  MENTEE_EMAIL, MENTEE_NAME, ADMIN_EMAIL,
  FEEDBACK_TEXT, FEEDBACK_RATING,
} from './fixtures.js'

import {
  login, signOut, goToAdmin, findMentor, clickFirstMatch,
  getPartnerName, submitFeedback, getFeedbackCount,
  adminSearchProfile, adminSwitchTab, adminExpandScores,
  adminExpandProfiles, adminExpandRawPayload, adminSearchFeedback,
  adminApprovePendingMatches, selectMentor,
  pause,
} from './helpers.js'

export default async function runScenario(page) {
  console.log('\n── Step 1: Mentee logs in ──')
  await login(page, MENTEE_EMAIL)
  console.log(`  Logged in as ${MENTEE_EMAIL}`)
  await pause(page)

  console.log('\n── Step 2: Mentee requests a match ──')
  const matchMsg = await findMentor(page)
  console.log(`  Result: ${matchMsg}`)
  if (matchMsg.includes('No mentors')) {
    throw new Error('No mentors available — check sample data and mentor max_capacity')
  }
  await pause(page)

  console.log('\n── Step 3: Admin reviews pending matches ──')
  await signOut(page)
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
  console.log('  Opened admin panel (Pending tab)')
  await pause(page, 1500)

  // Expand scores on the first pending match
  console.log('  Expanding match scores...')
  await adminExpandScores(page)
  await pause(page, 2000)

  // Approve top 2 candidates
  console.log('  Approving top 2 candidates...')
  const approved = await adminApprovePendingMatches(page, 2)
  console.log(`  Approved ${approved} candidates`)
  await pause(page, 1500)

  console.log('\n── Step 4: Mentee picks a mentor ──')
  await signOut(page)
  await login(page, MENTEE_EMAIL)
  console.log('  Mentee sees approved candidates')
  await pause(page, 1500)

  const selectMsg = await selectMentor(page)
  console.log(`  Selection result: ${selectMsg}`)
  await pause(page)

  console.log('\n── Step 5: Mentee views match detail ──')
  await clickFirstMatch(page)
  const partnerName = await getPartnerName(page)
  console.log(`  Matched with: ${partnerName}`)
  const matchUrl = page.url()
  await pause(page, 2000)

  console.log('\n── Step 6: Mentor views the same match ──')
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

  console.log('\n── Step 7: Mentee submits feedback ──')
  await signOut(page)
  await login(page, MENTEE_EMAIL)
  await clickFirstMatch(page)
  const fbMsg = await submitFeedback(page, FEEDBACK_TEXT, FEEDBACK_RATING)
  console.log(`  Feedback result: ${fbMsg}`)
  const fbCount = await getFeedbackCount(page)
  console.log(`  Feedback items visible: ${fbCount}`)
  await pause(page, 2000)

  console.log('\n── Step 8: Admin inspects in Search tab ──')
  await signOut(page)
  await login(page, ADMIN_EMAIL)
  await goToAdmin(page)
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
