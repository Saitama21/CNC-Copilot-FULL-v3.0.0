import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecoveryCodes, hashPassword, normalizeEmail, recoveryHash, tokenHash, validateEmail, validatePassword, verifyPassword } from '../src/auth-crypto.mjs';

test('normalizes email',()=>assert.equal(normalizeEmail(' Test@Example.COM '),'test@example.com'));
test('validates email',()=>assert.equal(validateEmail('a@b.com'),true));
test('rejects bad email',()=>assert.equal(validateEmail('abc'),false));
test('rejects short password',()=>assert.equal(validatePassword('abc1').ok,false));
test('accepts long alphanumeric password',()=>assert.equal(validatePassword('StrongPass123').ok,true));
test('password hashing verifies',()=>{const h=hashPassword('StrongPass123');assert.equal(verifyPassword('StrongPass123',h.salt,h.hash),true)});
test('wrong password fails',()=>{const h=hashPassword('StrongPass123');assert.equal(verifyPassword('WrongPass123',h.salt,h.hash),false)});
test('recovery codes are unique',()=>{const a=generateRecoveryCodes(6);assert.equal(new Set(a).size,6)});
test('recovery hashes normalize case',()=>assert.equal(recoveryHash('abcd-1234'),recoveryHash('ABCD-1234')));
test('token hash is deterministic',()=>assert.equal(tokenHash('x'),tokenHash('x')));
