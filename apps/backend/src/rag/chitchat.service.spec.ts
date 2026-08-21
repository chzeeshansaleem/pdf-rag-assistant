import { ChitchatService } from './chitchat.service';

describe('ChitchatService', () => {
  const service = new ChitchatService();

  describe('detects chitchat', () => {
    const cases: string[] = [
      'hello',
      'Hello!',
      'hi',
      'hey',
      'yo',
      'good morning',
      'Good Evening!',
      'how are you',
      "how're you?",
      "what's up?",
      'thanks',
      'thank you',
      'thank you so much',
      'bye',
      'goodbye',
      'see you later',
      'who are you?',
      'what can you do?',
      'how may i help you',
      'how can you help me?',
      'ok',
      'okay',
      'got it',
    ];

    it.each(cases)('classifies %j as chitchat and returns a non-empty reply', (message) => {
      expect(service.detect(message)).toEqual(expect.any(String));
    });
  });

  describe('does not misclassify real document questions', () => {
    const cases: string[] = [
      'How are leave days calculated?',
      'Who are the approvers for this policy?',
      'What can you tell me about the refund period in Finance.pdf?',
      'How may employees escalate a security incident?',
      'What is the company leave policy?',
      'Explain the second one.',
      'What about directors?',
      'How does MFA protect admin accounts?',
      'Thank you for the detailed breakdown of approval limits, but what about contractors?',
    ];

    it.each(cases)('does not classify %j as chitchat', (message) => {
      expect(service.detect(message)).toBeNull();
    });
  });

  it('returns different replies for different categories', () => {
    const greeting = service.detect('hello');
    const thanks = service.detect('thank you');
    const farewell = service.detect('bye');
    expect(greeting).not.toBe(thanks);
    expect(thanks).not.toBe(farewell);
  });

  it('is case-insensitive and tolerant of trailing punctuation', () => {
    expect(service.detect('HELLO!!!')).toEqual(service.detect('hello'));
    expect(service.detect('Thanks.')).toEqual(service.detect('thanks'));
  });

  it('returns null for an empty or whitespace-only message', () => {
    expect(service.detect('')).toBeNull();
    expect(service.detect('   ')).toBeNull();
  });

  describe('regression: space before a trailing question mark', () => {
    // "how are you ?" (space before "?") previously fell through to null
    // because the trailing punctuation class didn't allow whitespace
    // before "?" — reported directly by a user.
    const cases: string[] = ['how are you ?', 'what can you do ?', 'who are you ?', 'how may i help you ?'];

    it.each(cases)('classifies %j as chitchat despite the space before "?"', (message) => {
      expect(service.detect(message)).toEqual(expect.any(String));
    });
  });

  describe('regression: a greeting combined with the real ask in one message', () => {
    // "hello how can you help me ?" previously fell through to null because
    // the leading "hello" made the message fail every pattern's full-string
    // anchor — reported directly by a user. The message should be
    // classified by what follows the greeting, not treated as unmatched.
    it('classifies "hello how can you help me ?" as capability, not a bare greeting', () => {
      const capability = service.detect('what can you do?');
      expect(service.detect('hello how can you help me ?')).toBe(capability);
    });

    it('classifies "hi, how are you?" as wellbeing, not a bare greeting', () => {
      const wellbeing = service.detect('how are you?');
      expect(service.detect('hi, how are you?')).toBe(wellbeing);
    });

    it('still classifies a bare "hello" as a greeting (no false regression)', () => {
      expect(service.detect('hello')).toContain("Hello! I'm DocuMind AI");
    });
  });
});
