export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MESSAGE =
  "A senha deve ter pelo menos 8 caracteres e um caractere especial";

const SPECIAL_CHARACTERS = "!@#$%&*?_-";

export function getPasswordPolicyError(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_POLICY_MESSAGE;
  if (![...password].some((character) => SPECIAL_CHARACTERS.includes(character))) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

export function generateTemporaryPassword(length = 12) {
  const targetLength = Math.max(length, PASSWORD_MIN_LENGTH);
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const allCharacters = upper + lower + digits + SPECIAL_CHARACTERS;
  const password = [
    randomCharacter(upper),
    randomCharacter(lower),
    randomCharacter(digits),
    randomCharacter(SPECIAL_CHARACTERS),
  ];

  while (password.length < targetLength) password.push(randomCharacter(allCharacters));

  for (let index = password.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }

  return password.join("");
}

function randomCharacter(characters: string) {
  return characters[randomIndex(characters.length)];
}

function randomIndex(max: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}
