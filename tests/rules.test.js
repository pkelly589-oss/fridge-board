// Security rules tests. Run with `npm test` (starts the Firestore emulator).
import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, Timestamp,
} from 'firebase/firestore';

const OWNER = 'owner@example.com';
const MEMBER = 'member@example.com';
const STRANGER = 'stranger@example.com';

let env;

const as = (email, verified = true) =>
  env.authenticatedContext(email.split('@')[0], { email, email_verified: verified }).firestore();

const item = (over = {}) => ({
  list: 'fridge', name: 'Milk', qty: null, use_by: null, note: null,
  added_at: Timestamp.now(), added_by: MEMBER,
  done_at: null, done_by: null, archived_at: null, ...over,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-fridge-board',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'allowlist', OWNER), { role: 'owner' });
    await setDoc(doc(db, 'allowlist', MEMBER), { role: 'member' });
    await setDoc(doc(db, 'items', 'seed'), item());
  });
});

after(async () => { await env.cleanup(); });

test('signed-out visitors can read nothing', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'items', 'seed')));
  await assertFails(getDoc(doc(db, 'allowlist', OWNER)));
});

test('accounts not on the allowlist cannot read or write items', async () => {
  const db = as(STRANGER);
  await assertFails(getDoc(doc(db, 'items', 'seed')));
  await assertFails(getDocs(collection(db, 'items')));
  await assertFails(setDoc(doc(db, 'items', 'x'), item()));
});

test('unverified emails are refused even if allowlisted', async () => {
  await assertFails(getDoc(doc(as(MEMBER, false), 'items', 'seed')));
});

test('members can read, add, edit, cross off and delete items', async () => {
  const db = as(MEMBER);
  await assertSucceeds(getDocs(collection(db, 'items')));
  await assertSucceeds(setDoc(doc(db, 'items', 'new'), item({ name: 'Eggs', qty: '6' })));
  await assertSucceeds(updateDoc(doc(db, 'items', 'new'), { done_at: Timestamp.now(), done_by: MEMBER }));
  await assertSucceeds(updateDoc(doc(db, 'items', 'new'), { archived_at: Timestamp.now() }));
  await assertSucceeds(deleteDoc(doc(db, 'items', 'new')));
});

test('email case does not matter', async () => {
  await assertSucceeds(getDoc(doc(as('Member@Example.com'), 'items', 'seed')));
});

test('invalid items are rejected', async () => {
  const db = as(MEMBER);
  await assertFails(setDoc(doc(db, 'items', 'a'), item({ list: 'pantry' })));
  await assertFails(setDoc(doc(db, 'items', 'b'), item({ name: '' })));
  await assertFails(setDoc(doc(db, 'items', 'c'), item({ name: 'x'.repeat(121) })));
  await assertFails(setDoc(doc(db, 'items', 'd'), item({ use_by: 'tomorrow' })));
  await assertFails(setDoc(doc(db, 'items', 'e'), item({ extra: true })));
  await assertFails(setDoc(doc(db, 'items', 'f'), item({ added_at: 'yesterday' })));
  await assertSucceeds(setDoc(doc(db, 'items', 'g'), item({ use_by: '2026-10-30' })));
});

test('members can see only their own allowlist entry', async () => {
  const db = as(MEMBER);
  await assertSucceeds(getDoc(doc(db, 'allowlist', MEMBER)));
  await assertFails(getDoc(doc(db, 'allowlist', OWNER)));
  await assertFails(getDocs(collection(db, 'allowlist')));
  await assertFails(setDoc(doc(db, 'allowlist', STRANGER), { role: 'member' }));
  await assertFails(setDoc(doc(db, 'allowlist', MEMBER), { role: 'owner' }));
});

test('the owner manages the allowlist but cannot lock themselves out', async () => {
  const db = as(OWNER);
  await assertSucceeds(getDocs(collection(db, 'allowlist')));
  await assertSucceeds(setDoc(doc(db, 'allowlist', STRANGER), { role: 'member', added_at: Timestamp.now() }));
  await assertFails(setDoc(doc(db, 'allowlist', 'Upper@Example.com'), { role: 'member' }));
  await assertFails(setDoc(doc(db, 'allowlist', 'x@example.com'), { role: 'admin' }));
  await assertSucceeds(deleteDoc(doc(db, 'allowlist', STRANGER)));
  await assertFails(deleteDoc(doc(db, 'allowlist', OWNER)));
  await assertFails(updateDoc(doc(db, 'allowlist', OWNER), { role: 'member' }));
});

test('a removed member loses access straight away', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await deleteDoc(doc(ctx.firestore(), 'allowlist', MEMBER));
  });
  await assertFails(getDoc(doc(as(MEMBER), 'items', 'seed')));
});
