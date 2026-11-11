import countryList from 'country-list'

export const COUNTRIES = Object.fromEntries([
  ['US', 'United States'],
  ...countryList.getData()
    .filter(({ code }) => code !== 'US')
    .map(({ code, name }) => [code, name.replace(/\s*\(the\)$/i, '')])
    .sort((a, b) => a[1].localeCompare(b[1])),
])
