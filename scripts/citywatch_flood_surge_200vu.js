import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const apiBaseUrl = (__ENV.CITYWATCH_API_BASE_URL || 'https://citywatch-wyo9.onrender.com').replace(/\/$/, '');
const runId = __ENV.LOAD_TEST_RUN_ID || `flood-surge-${Date.now()}`;
const preflight = __ENV.TEST_MODE === 'preflight';
const diagnostic = __ENV.TEST_MODE === 'diagnostic';
const photoData = open('../apps/crm/alignment-fix-desktop.png', 'b');

const authDuration = new Trend('auth_duration', true);
const reportSubmissionDuration = new Trend('report_submission_duration', true);
const myReportDuration = new Trend('my_report_duration', true);
const feedDuration = new Trend('feed_duration', true);
const incidentDetailDuration = new Trend('incident_detail_duration', true);
const photoDuration = new Trend('photo_duration', true);
const adminQueueDuration = new Trend('admin_queue_duration', true);
const reportCreationSuccess = new Rate('report_creation_success');
const myReportSuccess = new Rate('my_report_success');
const endpointErrors = {
  auth: { transport: new Counter('auth_transport_failures'), client: new Counter('auth_client_failures'), server: new Counter('auth_server_failures') },
  create: { transport: new Counter('create_transport_failures'), client: new Counter('create_client_failures'), server: new Counter('create_server_failures') },
  mine: { transport: new Counter('my_report_transport_failures'), client: new Counter('my_report_client_failures'), server: new Counter('my_report_server_failures') },
  feed: { transport: new Counter('feed_transport_failures'), client: new Counter('feed_client_failures'), server: new Counter('feed_server_failures') },
  detail: { transport: new Counter('detail_transport_failures'), client: new Counter('detail_client_failures'), server: new Counter('detail_server_failures') },
  photo: { transport: new Counter('photo_transport_failures'), client: new Counter('photo_client_failures'), server: new Counter('photo_server_failures') },
  adminLogin: { transport: new Counter('admin_login_transport_failures'), client: new Counter('admin_login_client_failures'), server: new Counter('admin_login_server_failures') },
  adminQueue: { transport: new Counter('admin_queue_transport_failures'), client: new Counter('admin_queue_client_failures'), server: new Counter('admin_queue_server_failures') },
};

export const options = preflight
  ? {
      scenarios: {
        citizen_surge: {
          executor: 'per-vu-iterations',
          exec: 'citizen_surge',
          vus: 1,
          iterations: 1,
          maxDuration: '2m',
        },
      },
      thresholds: {
        report_creation_success: ['rate==1'],
        my_report_success: ['rate==1'],
      },
    }
  : diagnostic
    ? {
        scenarios: {
          citizen_surge: {
            executor: 'ramping-vus',
            exec: 'citizen_surge',
            startVUs: 0,
            gracefulRampDown: '15s',
            stages: [
              { duration: '15s', target: 50 },
              { duration: '60s', target: 50 },
              { duration: '15s', target: 0 },
            ],
          },
          staff_queue: {
            executor: 'constant-vus',
            exec: 'staff_queue',
            vus: 2,
            duration: '90s',
            gracefulStop: '15s',
          },
        },
      }
    : {
      scenarios: {
        citizen_surge: {
          executor: 'ramping-vus',
          exec: 'citizen_surge',
          startVUs: 0,
          gracefulRampDown: '30s',
          stages: [
            { duration: '30s', target: 50 },
            { duration: '60s', target: 50 },
            { duration: '30s', target: 100 },
            { duration: '60s', target: 100 },
            { duration: '30s', target: 150 },
            { duration: '60s', target: 150 },
            { duration: '30s', target: 200 },
            { duration: '5m', target: 200 },
            { duration: '60s', target: 0 },
          ],
        },
        staff_queue: {
          executor: 'constant-vus',
          exec: 'staff_queue',
          vus: 2,
          duration: '10m',
          startTime: '30s',
          gracefulStop: '15s',
        },
      },
      thresholds: {
        checks: ['rate>0.97'],
        http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '60s' }],
        report_creation_success: ['rate>0.97'],
        my_report_success: ['rate>0.97'],
        feed_duration: ['p(95)<2500'],
        incident_detail_duration: ['p(95)<2500'],
        report_submission_duration: ['p(95)<15000'],
        admin_queue_duration: ['p(95)<2500'],
      },
    };

let citizenToken;
let ownReportId;
let citizenInitialized = false;
let staffToken;

function recordUnexpectedResponse(counterSet, response) {
  if (response.status === 0) {
    counterSet.transport.add(1);
  } else if (response.status >= 500) {
    counterSet.server.add(1);
  } else if (response.status >= 400) {
    counterSet.client.add(1);
  }
}

function parseJson(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

function citizenHeaders() {
  return { Authorization: `Bearer ${citizenToken}` };
}

function ensureCitizen() {
  if (citizenInitialized) {
    return Boolean(citizenToken);
  }

  const response = http.post(
    `${apiBaseUrl}/auth/anonymous`,
    JSON.stringify({ device_id: `load-${runId}-vu-${__VU}` }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'auth-anonymous' } },
  );
  authDuration.add(response.timings.duration);
  recordUnexpectedResponse(endpointErrors.auth, response);
  const body = parseJson(response);
  citizenToken = body && body.token;
  citizenInitialized = true;
  check(response, { 'anonymous auth returns a token': (result) => result.status === 200 && Boolean(citizenToken) });
  return Boolean(citizenToken);
}

function submitFloodReport() {
  const latitude = (18.5204 + ((__VU % 20) - 10) * 0.00015).toFixed(6);
  const longitude = (73.8567 + ((__VU % 20) - 10) * 0.00015).toFixed(6);
  const response = http.post(
    `${apiBaseUrl}/incidents`,
    {
      title: `[LOAD-TEST ${runId}] Flood report from simulated citizen ${__VU}`,
      description: 'Synthetic flood-surge report with photo upload. This record is intentionally created by k6.',
      lat: latitude,
      lng: longitude,
      address: 'CityWatch flood-surge test location',
      photo: http.file(photoData, 'flood-surge.png', 'image/png'),
    },
    { headers: citizenHeaders(), tags: { endpoint: 'create-incident' }, timeout: '90s' },
  );
  reportSubmissionDuration.add(response.timings.duration);
  recordUnexpectedResponse(endpointErrors.create, response);
  const body = parseJson(response);
  ownReportId = body && body.id;
  const created = response.status === 200 && Boolean(ownReportId) && !(body.photo_url || '').startsWith('upload-failed:');
  reportCreationSuccess.add(created);
  check(response, { 'report is stored with a real photo': () => created });
}

function readMyReport() {
  if (!ownReportId) {
    return;
  }
  const response = http.get(`${apiBaseUrl}/me/incidents/${ownReportId}`, {
    headers: citizenHeaders(),
    tags: { endpoint: 'my-incident' },
  });
  myReportDuration.add(response.timings.duration);
  recordUnexpectedResponse(endpointErrors.mine, response);
  const persisted = response.status === 200;
  myReportSuccess.add(persisted);
  check(response, { 'created report persists for its citizen': () => persisted });
}

function browsePublicReports() {
  const response = http.get(`${apiBaseUrl}/incidents?lat=18.5204&lng=73.8567&radius_km=5&limit=20`, {
    tags: { endpoint: 'public-feed' },
  });
  feedDuration.add(response.timings.duration);
  recordUnexpectedResponse(endpointErrors.feed, response);
  const body = parseJson(response);
  const incidents = Array.isArray(body) ? body : body && Array.isArray(body.items) ? body.items : [];
  const feedOk = response.status === 200 && Array.isArray(incidents);
  check(response, { 'public feed returns incidents': () => feedOk });

  if (!feedOk || incidents.length === 0) {
    return;
  }

  const incident = incidents[__VU % incidents.length];
  const incidentId = incident && incident.id;
  if (!incidentId) {
    return;
  }

  const detailResponse = http.get(`${apiBaseUrl}/incidents/${incidentId}`, {
    tags: { endpoint: 'public-detail' },
  });
  incidentDetailDuration.add(detailResponse.timings.duration);
  recordUnexpectedResponse(endpointErrors.detail, detailResponse);
  check(detailResponse, { 'public incident detail returns 200': (result) => result.status === 200 });

  if ((__ITER + __VU) % 5 === 0) {
    const photoResponse = http.get(`${apiBaseUrl}/incidents/${incidentId}/photo`, {
      tags: { endpoint: 'public-photo' },
    });
    photoDuration.add(photoResponse.timings.duration);
    recordUnexpectedResponse(endpointErrors.photo, photoResponse);
    check(photoResponse, { 'public incident photo is available': (result) => result.status === 200 });
  }
}

function ensureStaff() {
  if (staffToken) {
    return true;
  }
  if (!__ENV.ADMIN_EMAIL || !__ENV.ADMIN_PASSWORD) {
    return false;
  }
  const response = http.post(
    `${apiBaseUrl}/admin/login`,
    JSON.stringify({ email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'admin-login' } },
  );
  const body = parseJson(response);
  recordUnexpectedResponse(endpointErrors.adminLogin, response);
  staffToken = body && body.token;
  check(response, { 'staff login returns a token': (result) => result.status === 200 && Boolean(staffToken) });
  return Boolean(staffToken);
}

export function citizen_surge() {
  if (!ensureCitizen()) {
    sleep(2);
    return;
  }

  if (__ITER === 0) {
    submitFloodReport();
    sleep(1 + Math.random() * 2);
    readMyReport();
  } else {
    browsePublicReports();
  }

  sleep(2 + Math.random() * 3);
}

export function staff_queue() {
  if (!ensureStaff()) {
    sleep(5);
    return;
  }
  const response = http.get(`${apiBaseUrl}/admin/incidents?q=${encodeURIComponent(`[LOAD-TEST ${runId}]`)}`, {
    headers: { Authorization: `Bearer ${staffToken}` },
    tags: { endpoint: 'admin-queue' },
  });
  adminQueueDuration.add(response.timings.duration);
  recordUnexpectedResponse(endpointErrors.adminQueue, response);
  check(response, { 'staff queue remains available': (result) => result.status === 200 });
  sleep(3 + Math.random() * 4);
}
