import {
  decryptPrivateMessage,
  encryptPrivateMessage,
  type StoredLocalKeyBundle,
} from './crypto';
import type {
  DailyChallengeAssignment,
  DeepTalkQuestionState,
  DeepTalkSession,
  EncryptedConnectionAnswer,
  PublicUser,
} from '../types/nexora';

export async function encryptConnectionAnswerPayload(input: {
  text: string;
  aad: string;
  myUserId: string;
  myKeys: StoredLocalKeyBundle;
  peerUser: PublicUser;
}) {
  if (!input.peerUser.ecdhPublicJwk) {
    throw new Error('Your friend must initialize device encryption keys first.');
  }
  return encryptPrivateMessage(
    { text: input.text },
    input.aad,
    [
      { userId: input.myUserId, ecdhPublicJwk: JSON.stringify(input.myKeys.ecdhPublicJwk) },
      { userId: input.peerUser.id, ecdhPublicJwk: input.peerUser.ecdhPublicJwk },
    ]
  );
}

export async function decryptConnectionAnswer(
  answer: EncryptedConnectionAnswer,
  myUserId: string,
  myKeys: StoredLocalKeyBundle
): Promise<EncryptedConnectionAnswer> {
  if (answer.localText) return answer;
  const env = answer.recipientEnvelopes?.[myUserId];
  if (!env) {
    return { ...answer, localText: '[Encrypted on another device key]' };
  }
  try {
    const dec = await decryptPrivateMessage(
      answer.ciphertext,
      answer.iv,
      answer.aad,
      env,
      myKeys.ecdhPrivateJwk
    );
    return { ...answer, localText: dec.text };
  } catch {
    return { ...answer, localText: '[Unable to decrypt on this device]' };
  }
}

async function decryptQuestionState(
  card: DeepTalkQuestionState,
  myUserId: string,
  myKeys: StoredLocalKeyBundle
): Promise<DeepTalkQuestionState> {
  const answers = await Promise.all(
    card.answers.map((a) => decryptConnectionAnswer(a, myUserId, myKeys))
  );
  return { ...card, answers };
}

export async function decryptDeepTalkSession(
  session: DeepTalkSession,
  myUserId: string,
  myKeys: StoredLocalKeyBundle
): Promise<DeepTalkSession> {
  const currentCard = session.currentCard
    ? await decryptQuestionState(session.currentCard, myUserId, myKeys)
    : null;
  const revealedHistory = await Promise.all(
    session.revealedHistory.map((c) => decryptQuestionState(c, myUserId, myKeys))
  );
  return { ...session, currentCard, revealedHistory };
}

export async function decryptDailyAssignment(
  assignment: DailyChallengeAssignment,
  myUserId: string,
  myKeys: StoredLocalKeyBundle
): Promise<DailyChallengeAssignment> {
  const responses = await Promise.all(
    assignment.responses.map((r) => decryptConnectionAnswer(r, myUserId, myKeys))
  );
  return { ...assignment, responses };
}
