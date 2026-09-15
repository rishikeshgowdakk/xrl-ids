import fetch from 'node-fetch';

async function testAction(action, ip = '192.168.0.100') {
  console.log(`\nTesting action: ${action} for IP: ${ip}`);
  const event = {
    id: `test_${action}_${Date.now()}`,
    timestamp: Date.now(),
    source_ip: ip,
    destination_ip: '10.0.0.1',
    protocol: 'TCP',
    attackType: action === 'ALLOW' ? 'BENIGN' : 'ATTACK',
    eventMode: 'simulation',
    realPrediction: {
      dqn: {
        action: action,
        q_values: { ALLOW: 1.0, ALERT: 1.0, BLOCK: 1.0 }
      }
    }
  };

  const res = await fetch('http://127.0.0.1:3000/api/db/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  console.log(`Status: ${res.status}`);
}

await testAction('ALLOW');
await testAction('ALERT');
await testAction('BLOCK');
await testAction('BLOCK', 'invalid_ip'); // Invalid IP
await testAction('BLOCK', '127.0.0.1'); // Host IP guards
