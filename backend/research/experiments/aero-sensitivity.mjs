import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Generic analytical model. These are illustrative inputs, NOT Ferrari telemetry.
export const assumptions = {
  densitiesKgM3: [0.85, 0.95, 1.05], speedsMS: [60, 75, 90], floorLossFractions: [0, 0.1, 0.2],
  referenceDensityKgM3: 1.225, downforceAreaM2: 4, dragAreaM2: 1.2, floorShare: 0.6,
  inletAreaM2: 0.05, inletVelocityFraction: 0.6,
};
export const variants = [
  { name: 'Baseline', wingGain: 0, dragGain: 0, inletGain: 0, lossMultiplier: 1 },
  { name: 'Higher wing loading', wingGain: 0.1, dragGain: 0.08, inletGain: 0, lossMultiplier: 1 },
  { name: 'Larger cooling inlet', wingGain: 0, dragGain: 0.03, inletGain: 0.15, lossMultiplier: 1 },
  { name: 'More stable floor platform', wingGain: 0, dragGain: 0.01, inletGain: 0, lossMultiplier: 0.5 },
];
export function evaluate({ density, speed, floorLoss }, variant = variants[0]) {
  if (![density, speed, floorLoss].every(Number.isFinite) || density <= 0 || speed < 0 || floorLoss < 0 || floorLoss > 1) throw new Error('Invalid model inputs');
  const a = assumptions, q = 0.5 * density * speed ** 2;
  const downforceArea = a.downforceAreaM2 * ((1 - a.floorShare) * (1 + variant.wingGain) + a.floorShare * (1 - floorLoss * variant.lossMultiplier));
  const drag = q * a.dragAreaM2 * (1 + variant.dragGain);
  return { downforceN: q * downforceArea, dragN: drag, dragPowerKW: drag * speed / 1000,
    coolingMassFlowProxyKgS: density * speed * a.inletVelocityFraction * a.inletAreaM2 * (1 + variant.inletGain) };
}

export async function runSensitivity(outputDirectory) {
  const cases = [];
  for (const density of assumptions.densitiesKgM3) for (const speed of assumptions.speedsMS) for (const floorLoss of assumptions.floorLossFractions) {
    const inputs = { density, speed, floorLoss };
    for (const variant of variants) cases.push({ variant: variant.name, inputs, outputs: evaluate(inputs, variant) });
  }
  const centralInputs = { density: 0.95, speed: 75, floorLoss: 0.1 };
  const central = variants.map(v => ({ variant: v.name, ...evaluate(centralInputs, v) }));
  const result = { status: 'completed', kind: 'analytical-parameter-sweep', validation: 'simulated-not-real-world-validated',
    objective: 'Illustrate high-altitude aero/cooling trade-offs for the Ferrari discussion without claiming to model Ferrari.',
    createdAt: new Date().toISOString(), sourceSHA256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    assumptions, variants, centralInputs, central, cases,
    limitations: [
      'All vehicle coefficients and modification effects are assumed, not measured or calibrated. Percent gains largely reflect chosen input multipliers.',
      'The density range is an exploratory input, not a forecast for the 2026 Mexico City Grand Prix.',
      'No CFD mesh, geometry, tyre model, circuit model, thermal network, suspension dynamics, active aero or power-unit model is present.',
      'Inlet mass flow is a proxy using a fixed velocity fraction, not radiator heat rejection or temperature. Pressure losses and compressibility are omitted.',
      'Cannot predict lap time, validate a setup, establish legality, identify Ferrari upgrades or rank Ferrari against other teams.',
    ],
    equations: ['q = 0.5 * rho * V^2', 'downforce = q * effective downforce area', 'drag = q * drag area', 'drag power = drag * V', 'cooling flow proxy = rho * (0.6 * V) * inlet area'],
    references: ['https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/', 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/mass-flow-rate-equations/'],
  };
  const fmt = n => n.toFixed(2);
  const markdown = [
    '# Exploratory aerodynamic sensitivity simulation', '',
    `Completed ${cases.length} analytical cases. This is a generic scenario model, **not Ferrari CFD or real-world validation**.`, '',
    '## Assumptions', '',
    `Densities: ${assumptions.densitiesKgM3.join(', ')} kg/m³; speeds: ${assumptions.speedsMS.join(', ')} m/s; assumed floor losses: 0%, 10%, 20%.`,
    'Baseline downforce area 4 m² (60% floor), drag area 1.2 m², inlet area 0.05 m², inlet velocity 60% of vehicle speed. These values are invented model parameters, not Ferrari specifications.',
    'Variants: wing contribution +10% with total drag +8%; inlet area +15% with drag +3%; floor loss halved with drag +1%. Effects are assumptions to be tested, not discoveries.', '',
    '## Central case: 0.95 kg/m³, 75 m/s (270 km/h), 10% floor loss', '',
    '| Assumed configuration | Downforce N | Drag N | Drag power kW | Cooling-flow proxy kg/s |',
    '|---|---:|---:|---:|---:|',
    ...central.map(c => `| ${c.variant} | ${fmt(c.downforceN)} | ${fmt(c.dragN)} | ${fmt(c.dragPowerKW)} | ${fmt(c.coolingMassFlowProxyKgS)} |`), '',
    'At fixed coefficients and speed, changing density from the assumed reference 1.225 to 0.95 kg/m³ reduces aerodynamic forces and the mass-flow proxy by 22.45%. This is algebraic sensitivity, not a measured race condition.', '',
    '## Interpretation and next validation', '',
    '- Wing loading adds downforce but has a drag-power cost; test both relevant aero modes and matched aerodynamic balance using actual geometry.',
    '- Larger inlet raises the assumed mass-flow proxy but costs drag; use a pressure-loss and heat-exchanger model with known heat loads before claiming better temperatures.',
    '- Floor-platform stability helps only if baseline floor losses exist. At zero assumed loss it provides no downforce benefit and still incurs the assumed drag penalty. Validate ride-height/pitch/yaw sweeps and kerb response with suspension and tyre models.',
    '- None of these results selects a fastest configuration. Real aerodynamic maps, tyre loads, circuit traces and calibrated cooling data are necessary for that decision.', '',
    '## Limitations', '', ...result.limitations.map(s => `- ${s}`), '',
    '## Reproduce', '', '`node backend/research/experiments/aero-sensitivity.mjs`', '',
    `Model source SHA-256: ${result.sourceSHA256}`, '',
    'Equations: [NASA drag equation](' + result.references[0] + ') and [NASA continuity equation](' + result.references[1] + '). These sources support the equations, not the chosen car coefficients.',
  ].join('\n');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'results.json'), JSON.stringify(result, null, 2));
  await writeFile(resolve(outputDirectory, 'report.md'), markdown);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runSensitivity(resolve('work/aero-sensitivity'));
  console.log(JSON.stringify({ cases: result.cases.length, status: result.status, central: result.central, report: 'work/aero-sensitivity/report.md' }, null, 2));
}
