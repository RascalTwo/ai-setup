// Allure 3 preset: reads both runners' JUnit XML, prints one list, writes one HTML report, and fails on
// any failed test or fewer tests than expected (a runner that silently ran nothing).
/** @param {{ name: string, minTestsCount: number, output?: string }} options */
export const allure = ({ name, minTestsCount, output = "out/allure-report" }) => ({
  name,
  output,
  plugins: { awesome: {}, log: { options: { groupBy: "none" } } },
  qualityGate: { rules: [{ maxFailures: 0 }, { minTestsCount }] },
});
