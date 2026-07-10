const { resolveLetterheadUrl } = require('../utils/prescriptionPdfHelpers');

describe('resolveLetterheadUrl', () => {
  it('prefers the explicit letterhead url sent by the client', () => {
    expect(resolveLetterheadUrl('https://client.example/letterhead.png', 'https://doctor.example/letterhead.png')).toBe('https://client.example/letterhead.png');
  });

  it('falls back to the doctor profile letterhead when no explicit url is provided', () => {
    expect(resolveLetterheadUrl(null, 'https://doctor.example/letterhead.png')).toBe('https://doctor.example/letterhead.png');
  });
});
