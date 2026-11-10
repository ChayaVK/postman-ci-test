// A small SOAP 1.1 service: Calculator with Add, Subtract, Multiply, Divide, plus its WSDL.
'use strict';
const { send } = require('./core');

const NS = 'http://practice-api.local/calculator';
const OPS = ['Add', 'Subtract', 'Multiply', 'Divide'];

function wsdl(host) {
  const msgs = OPS.map((o) => `
  <message name="${o}Request"><part name="parameters" element="tns:${o}"/></message>
  <message name="${o}Response"><part name="parameters" element="tns:${o}Response"/></message>`).join('');
  const elems = OPS.map((o) => `
      <xs:element name="${o}"><xs:complexType><xs:sequence>
        <xs:element name="intA" type="xs:int"/><xs:element name="intB" type="xs:int"/>
      </xs:sequence></xs:complexType></xs:element>
      <xs:element name="${o}Response"><xs:complexType><xs:sequence>
        <xs:element name="${o}Result" type="xs:int"/>
      </xs:sequence></xs:complexType></xs:element>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="Calculator" targetNamespace="${NS}" xmlns:tns="${NS}"
  xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <types>
    <xs:schema targetNamespace="${NS}" elementFormDefault="qualified">${elems}
    </xs:schema>
  </types>${msgs}
  <portType name="CalculatorPortType">${OPS.map((o) => `
    <operation name="${o}"><input message="tns:${o}Request"/><output message="tns:${o}Response"/></operation>`).join('')}
  </portType>
  <binding name="CalculatorBinding" type="tns:CalculatorPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>${OPS.map((o) => `
    <operation name="${o}"><soap:operation soapAction="${NS}/${o}"/>
      <input><soap:body use="literal"/></input><output><soap:body use="literal"/></output></operation>`).join('')}
  </binding>
  <service name="CalculatorService">
    <port name="CalculatorPort" binding="tns:CalculatorBinding">
      <soap:address location="http://${host}/soap/calculator"/>
    </port>
  </service>
</definitions>
`;
}

const envelope = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
${inner}
  </soap:Body>
</soap:Envelope>
`;

const fault = (res, code, text) => send(res, 500, envelope(`    <soap:Fault>
      <faultcode>soap:${code}</faultcode>
      <faultstring>${text}</faultstring>
    </soap:Fault>`), { 'Content-Type': 'text/xml; charset=utf-8' });

function handle(req, res) {
  if (req.method === 'GET') {
    if (req.query.has('wsdl') || req.query.has('WSDL')) return send(res, 200, wsdl(req.headers.host || 'localhost:3000'), { 'Content-Type': 'text/xml; charset=utf-8' });
    return send(res, 200, 'This is a SOAP service. GET /soap/calculator?wsdl for its WSDL, or POST a SOAP envelope.');
  }
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('text/xml') && !ct.includes('application/soap+xml')) return fault(res, 'Client', 'Send the SOAP envelope with Content-Type: text/xml.');
  const xml = typeof req.body === 'string' ? req.body : '';
  if (!/<(\w+:)?Envelope[\s>]/.test(xml) || !/<(\w+:)?Body[\s>]/.test(xml)) return fault(res, 'Client', 'The request is not a SOAP envelope (missing Envelope or Body).');
  const opMatch = new RegExp(`<(?:\\w+:)?(${OPS.join('|')})[\\s>]`).exec(xml);
  if (!opMatch) return fault(res, 'Client', `Unknown operation. Supported: ${OPS.join(', ')}.`);
  const op = opMatch[1];
  const num = (tag) => {
    const m = new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*?)\\s*</(?:\\w+:)?${tag}>`).exec(xml);
    return m ? m[1] : null;
  };
  const a = num('intA'), b = num('intB');
  if (a === null || b === null) return fault(res, 'Client', `${op} needs both intA and intB.`);
  if (!/^-?\d+$/.test(a) || !/^-?\d+$/.test(b)) return fault(res, 'Client', 'intA and intB must be whole numbers.');
  const x = Number(a), y = Number(b);
  if (op === 'Divide' && y === 0) return fault(res, 'Server', 'Cannot divide by zero.');
  const result = { Add: x + y, Subtract: x - y, Multiply: x * y, Divide: Math.trunc(x / y) }[op];
  send(res, 200, envelope(`    <${op}Response xmlns="${NS}">
      <${op}Result>${result}</${op}Result>
    </${op}Response>`), { 'Content-Type': 'text/xml; charset=utf-8' });
}

module.exports = { handle };
