import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserAuth} from '../src/web/browser-auth.js';
test('attendance report resumes once only after matching Microsoft account and scopes',async()=>{
 const account={homeAccountId:'account-1',username:'person@example.invalid'};
 const config={tenantId:'tenant',clientId:'client',scopes:['User.Read'],webRedirectUri:'https://www.energeticabr.com/energetico/'};
 for(const [redirect,want] of [
  [{account,accessToken:'test-token',scopes:['Sites.Read.All']},'action_attendance_summary'],
  [{account:{...account,homeAccountId:'other'},accessToken:'test-token',scopes:['Sites.Read.All']},null],
  [{account,accessToken:'test-token',scopes:['User.Read']},null],
 ]){
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const first=createBrowserAuth({storage,config,client:{async initialize(){},async handleRedirectPromise(){return null;},getAllAccounts(){return [account];},async acquireTokenRedirect(){}}});
  await first.initialize();await first.authorize(['Sites.Read.All'],{resumeAction:'action_attendance_summary'});
  const second=createBrowserAuth({storage,config,client:{async initialize(){},async handleRedirectPromise(){return redirect;},getAllAccounts(){return [account];}}});
  await second.initialize();assert.equal(second.consumePendingAction(),want);assert.equal(second.consumePendingAction(),null);
 }
});
