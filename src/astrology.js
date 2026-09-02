// Phase 3 — Deterministic astrology engine. Offline, no API, no ephemeris files.
//
// Computes ecliptic longitude -> zodiac sign for the Sun and planets from a
// birth DATE. Birth time is OPTIONAL and intentionally unused for sign
// placement (planet signs move slowly enough that the calendar date fixes them,
// except the Moon).
//
// STRICT SPLIT (per spec):
//   available WITHOUT birth time : Sun, Mercury, Venus, Mars, Jupiter, Saturn,
//                                  Uranus, Neptune, Pluto  (sign only)
//   Moon (Option B)             : included ONLY when the date is unambiguous
//                                  (whole day stays in one sign with margin),
//                                  otherwise omitted with a note.
//   NEVER computed here         : Ascendant, houses, Midheaven (need exact time
//                                  + place). Listed in `excluded`.
//
// Accuracy: low-precision Meeus/VSOP87 truncations. Well within 1° for the Sun
// and comfortably sign-accurate for the planets over 1900-2100 — more than
// enough to name a zodiac sign. This is not an ephemeris-grade tool and is not
// used for degrees/aspects.

const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

const D2R = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;
const signOf = (lon) => SIGNS[Math.floor(norm360(lon) / 30)];
const degInSign = (lon) => norm360(lon) % 30;

// Julian Day for a UTC calendar date at a given fractional day hour.
function julianDay(year, month, day, hourUTC = 12) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jd = Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day + (hourUTC / 24) + B - 1524.5;
  return jd;
}

// Julian centuries from J2000.0
const T_of = (jd) => (jd - 2451545.0) / 36525;

// ---- Sun (Meeus, ch.25, low precision) -> apparent ecliptic longitude ------
function sunLongitude(jd) {
  const T = T_of(jd);
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const Mr = M * D2R;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
    + 0.000289 * Math.sin(3 * Mr);
  return norm360(L0 + C); // true geometric longitude (sign-accurate)
}

// ---- Moon (Meeus, low precision) -> ecliptic longitude ---------------------
function moonLongitude(jd) {
  const T = T_of(jd);
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
    + (T * T * T) / 538841 - (T * T * T * T) / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
    + (T * T * T) / 545868;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
    + (T * T * T) / 69699;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T;
  const Dr = D * D2R, Mr = M * D2R, Mpr = Mp * D2R, Fr = F * D2R;
  // Main periodic terms (deg). Truncated but sign-accurate.
  let lon = Lp
    + 6.288774 * Math.sin(Mpr)
    + 1.274027 * Math.sin(2 * Dr - Mpr)
    + 0.658314 * Math.sin(2 * Dr)
    + 0.213618 * Math.sin(2 * Mpr)
    - 0.185116 * Math.sin(Mr)
    - 0.114332 * Math.sin(2 * Fr)
    + 0.058793 * Math.sin(2 * Dr - 2 * Mpr)
    + 0.057066 * Math.sin(2 * Dr - Mr - Mpr)
    + 0.053322 * Math.sin(2 * Dr + Mpr)
    + 0.045758 * Math.sin(2 * Dr - Mr)
    - 0.040923 * Math.sin(Mr - Mpr)
    - 0.034720 * Math.sin(Dr)
    - 0.030383 * Math.sin(Mr + Mpr);
  return norm360(lon);
}

// ---- Planets: low-precision mean elements (heliocentric) + reduction to
// geocentric ecliptic longitude via vector subtraction of Earth's position.
// Elements from Meeus/Standish (J2000, linear rates per century). Good enough
// for sign placement over modern dates.
const PLANET_ELEMENTS = {
  Mercury: { a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.25032350, wbar: 77.45779628, O: 48.33076593,
             aR: 0, eR: 0.00001906, IR: -0.00594749, LR: 149472.67411175, wbarR: 0.16047689, OR: -0.12534081 },
  Venus:   { a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.97909950, wbar: 131.60246718, O: 76.67984255,
             aR: 0, eR: -0.00004107, IR: -0.00078890, LR: 58517.81538729, wbarR: 0.00268329, OR: -0.27769418 },
  Earth:   { a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, wbar: 102.93768193, O: 0.0,
             aR: 0.00000562, eR: -0.00004392, IR: -0.01294668, LR: 35999.37244981, wbarR: 0.32327364, OR: 0.0 },
  Mars:    { a: 1.52371034, e: 0.09339410, I: 1.84969142, L: -4.55343205, wbar: -23.94362959, O: 49.55953891,
             aR: 0.00001847, eR: 0.00007882, IR: -0.00813131, LR: 19140.30268499, wbarR: 0.44441088, OR: -0.29257343 },
  Jupiter: { a: 5.20288700, e: 0.04838624, I: 1.30439695, L: 34.39644051, wbar: 14.72847983, O: 100.47390909,
             aR: -0.00011607, eR: -0.00013253, IR: -0.00183714, LR: 3034.74612775, wbarR: 0.21252668, OR: 0.20469106 },
  Saturn:  { a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, wbar: 92.59887831, O: 113.66242448,
             aR: -0.00125060, eR: -0.00050991, IR: 0.00193609, LR: 1222.49362201, wbarR: -0.41897216, OR: -0.28867794 },
  Uranus:  { a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, wbar: 170.95427630, O: 74.01692503,
             aR: -0.00196176, eR: -0.00004397, IR: -0.00242939, LR: 428.48202785, wbarR: 0.40805281, OR: 0.04240589 },
  Neptune: { a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, wbar: 44.96476227, O: 131.78422574,
             aR: 0.00026291, eR: 0.00005105, IR: 0.00035372, LR: 218.45945325, wbarR: -0.32241464, OR: -0.00508664 },
  Pluto:   { a: 39.48211675, e: 0.24882730, I: 17.14001206, L: 238.92903833, wbar: 224.06891629, O: 110.30393684,
             aR: -0.00031596, eR: 0.00005170, IR: 0.00004818, LR: 145.20780515, wbarR: -0.04062942, OR: -0.01183482 },
};

function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) {
    const dM = M - (E - e * Math.sin(E));
    E += dM / (1 - e * Math.cos(E));
  }
  return E;
}

// Heliocentric ecliptic rectangular coords (J2000) for a body at time T (cy).
function heliocentricXYZ(el, T) {
  const a = el.a + el.aR * T;
  const e = el.e + el.eR * T;
  const I = (el.I + el.IR * T) * D2R;
  const L = el.L + el.LR * T;
  const wbar = el.wbar + el.wbarR * T;
  const O = (el.O + el.OR * T) * D2R;
  const w = (wbar - (el.O + el.OR * T)) * D2R;
  let M = norm360(L - wbar) * D2R;
  if (M > Math.PI) M -= 2 * Math.PI;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  // rotate to ecliptic
  const cosw = Math.cos(w), sinw = Math.sin(w);
  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const x = (cosw * cosO - sinw * sinO * cosI) * xp + (-sinw * cosO - cosw * sinO * cosI) * yp;
  const y = (cosw * sinO + sinw * cosO * cosI) * xp + (-sinw * sinO + cosw * cosO * cosI) * yp;
  const z = (sinw * sinI) * xp + (cosw * sinI) * yp;
  return { x, y, z };
}

function planetLongitude(name, jd) {
  const T = T_of(jd);
  const p = heliocentricXYZ(PLANET_ELEMENTS[name], T);
  const earth = heliocentricXYZ(PLANET_ELEMENTS.Earth, T);
  const gx = p.x - earth.x, gy = p.y - earth.y;
  return norm360(Math.atan2(gy, gx) / D2R);
}

const TIME_INDEPENDENT = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

// ---- top-level -------------------------------------------------------------
// birthplace is accepted but NOT required and does not affect sign placement
// (signs are place-independent). It's stored for context only.
function computeAstrology({ birthday, birthplace = null } = {}) {
  const out = {
    available: false,
    placements: {},
    moon: { sign: null, degree: null, confidence: null, note: null },
    excluded: ["ascendant", "houses", "midheaven"],
    birthplace: birthplace || null,
    note: "",
    method: "Low-precision Meeus/VSOP; sign-accurate, not ephemeris-grade. Birth time not used.",
  };
  if (!birthday) {
    out.note = "No birthday provided; astrology omitted.";
    return out;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday).trim());
  if (!m) throw new Error(`birthday must be YYYY-MM-DD, got "${birthday}"`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];

  // Evaluate at 12:00 UTC (midday) so an unknown time sits mid-day.
  const jdNoon = julianDay(year, month, day, 12);

  // Sun
  const sunLon = sunLongitude(jdNoon);
  out.placements.Sun = { sign: signOf(sunLon), degree: +degInSign(sunLon).toFixed(2) };

  // Planets (time-independent for sign purposes)
  for (const name of TIME_INDEPENDENT) {
    const lon = planetLongitude(name, jdNoon);
    out.placements[name] = { sign: signOf(lon), degree: +degInSign(lon).toFixed(2) };
  }

  // Moon — Option B: only report a sign if the WHOLE day stays in one sign,
  // with a safety margin, so it can't be wrong due to unknown time.
  const jd0 = julianDay(year, month, day, 0);    // 00:00 UTC
  const jd24 = julianDay(year, month, day, 24);  // 24:00 UTC (next midnight)
  const moon0 = moonLongitude(jd0);
  const moon24 = moonLongitude(jd24);
  const moonNoon = moonLongitude(jdNoon);
  const sign0 = signOf(moon0), sign24 = signOf(moon24), signNoon = signOf(moonNoon);
  const d0 = degInSign(moon0), d24 = degInSign(moon24);
  const MARGIN = 1.5; // deg away from a cusp required to be confident
  const cuspSafe0 = d0 >= MARGIN && d0 <= 30 - MARGIN;
  const cuspSafe24 = d24 >= MARGIN && d24 <= 30 - MARGIN;
  if (sign0 === sign24 && sign0 === signNoon && cuspSafe0 && cuspSafe24) {
    out.moon = {
      sign: signNoon,
      degree: +degInSign(moonNoon).toFixed(2),
      confidence: "date-unambiguous",
      note: "Moon stayed in one sign for the whole birth date; reported without birth time.",
    };
  } else {
    out.moon = {
      sign: null,
      degree: null,
      confidence: "ambiguous-without-birth-time",
      note: "Moon changed sign (or sat near a cusp) on this date; omitted because no birth time was provided.",
    };
  }

  out.available = true;
  out.note = "Sun and planet signs are place-independent and time-independent. " +
    "Ascendant, houses, and Midheaven require an exact birth time and place and are not computed.";
  return out;
}

module.exports = {
  SIGNS, julianDay, sunLongitude, moonLongitude, planetLongitude,
  signOf, degInSign, computeAstrology, TIME_INDEPENDENT,
};
