// Requests ad decisions at a fixed rate. Run through `npm run load:test`.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const { RATE, DURATION, SHOW, KEY, TARGETS, MAX_DECISIONS } = __ENV;

const targets = TARGETS.split(',');
const served = new Counter('ads_served');
const empty = new Counter('ads_refused');

const scenario = MAX_DECISIONS
  ? {
      executor: 'shared-iterations',
      vus: 300,
      iterations: Number(MAX_DECISIONS),
      maxDuration: '5m',
    }
  : {
      executor: 'constant-arrival-rate',
      rate: Number(RATE),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 200,
      maxVUs: 2000,
    };

export const options = {
  scenarios: { decisions: scenario },
  thresholds: { http_req_failed: ['rate<0.001'] },
};

const headers = { 'x-ingest-key': KEY };

export default function decide() {
  const query = `showId=${SHOW}&slot=MID_ROLL&country=DE&device=CTV`;
  const url = `${targets[__ITER % targets.length]}/ad-decision?${query}`;
  const response = http.get(url, { headers });

  if (check(response, { answered: ({ status }) => status === 200 })) {
    if (response.json().data) served.add(1);
    else empty.add(1);
  }
}
