import http from 'k6/http';
import { check, sleep } from 'k6';

const apiBaseUrl = (__ENV.CITYWATCH_API_BASE_URL || 'https://citywatch-wyo9.onrender.com').replace(/\/$/, '');
const feedUrl = `${apiBaseUrl}/incidents?lat=18.5204&lng=73.8567&radius_km=5&limit=20`;

export const options = {
  scenarios: {
    public_feed_browsing: {
      executor: 'ramping-vus',
      startVUs: 0,
      gracefulRampDown: '10s',
      stages: [
        { duration: '20s', target: 5 },
        { duration: '30s', target: 10 },
        { duration: '45s', target: 25 },
        { duration: '90s', target: 50 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    checks: [{ threshold: 'rate>0.98', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_failed: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<2500', abortOnFail: true, delayAbortEval: '45s' }],
  },
};

export default function () {
  const response = http.get(feedUrl, {
    tags: { endpoint: 'public-feed' },
  });

  check(response, {
    'public feed returns 200': (result) => result.status === 200,
    'public feed returns JSON': (result) =>
      (result.headers['Content-Type'] || '').includes('application/json'),
  });

  sleep(2 + Math.random() * 3);
}
