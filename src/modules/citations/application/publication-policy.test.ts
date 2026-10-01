import { describe, expect, it } from 'vitest';
import { citedOpinionPublicationReasons } from './publish-cited-federal-opinions';
const candidate: Parameters<typeof citedOpinionPublicationReasons>[0]={
  caseId:'case',documentId:'document',publication:'draft',documentPublication:'draft',
  caption:'Example v. Agency',docketNumber:'23-101',courtJurisdiction:'f',courtProviderId:'ca2',courtVerification:'verified',
  sourceArtifactId:'artifact',sourceProviderCode:'courtlistener',sourceRecordId:'1',
  sourceUri:'https://www.courtlistener.com/api/rest/v4/dockets/1/',sourceContentHash:'a'.repeat(64),sourceRetrievedAt:'2026-09-30T12:00:00Z',
  hasReadableContent:true,canonicalIdentifier:'1',canonicalIdentifierCount:1,identityCollisionCount:1,unresolvedRejections:0,restrictedText:'Public appellate opinion',
  wordCount:200,contentText:'Public court text',documentHash:'b'.repeat(64),artifactHash:'c'.repeat(64),
  documentSourceUri:'https://www.courtlistener.com/api/rest/v4/opinions/2/',documentProvider:'courtlistener',blocked:false,
};
describe('cited federal opinion publication',()=>{
  it('accepts a sourced, complete federal opinion that passed existing validation',()=>expect(citedOpinionPublicationReasons(candidate)).toEqual([]));
  it('holds restricted, sensitive, ambiguous, thin and unverified records',()=>{
    expect(citedOpinionPublicationReasons({...candidate,blocked:true,wordCount:10,contentText:'SSN 123-45-6789',courtVerification:'not_verified',identityCollisionCount:2,restrictedText:'Under seal'})).toEqual(expect.arrayContaining(['existing_publication_or_review_restriction','thin_opinion','sensitive_opinion_text','unverified_court_record','duplicate_identity_collision','restricted_or_sensitive']));
  });
  it('requires the retrieved CourtListener opinion evidence, with a checksum',()=>{
    expect(citedOpinionPublicationReasons({...candidate,documentSourceUri:'https://example.com/claim',documentHash:''})).toEqual(expect.arrayContaining(['unverified_opinion_source','missing_document_provenance']));
  });
});
