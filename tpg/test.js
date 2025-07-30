function getMessageIdFromRaw(rawMessage) {
  const lowByte = rawMessage[6];
  const highByte = rawMessage[7];
  const messageId = lowByte | (highByte << 8);
  return messageId;
}

const testMessage = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
console.log('Message ID:', getMessageIdFromRaw(testMessage));
console.log('Calculation: 6 | (7 << 8) =', 6 | (7 << 8));