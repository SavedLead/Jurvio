import { describe, expect, it } from "vitest";
import { initialCaseStatus, replayStatus, STATUS_RULE_VERSION, type StatusEvent } from "./status";

const event = (value: Partial<StatusEvent> & Pick<StatusEvent,"id"|"type"|"occurredOn">): StatusEvent => ({
  sourceLabel:`Docket entry ${value.id}`,sourceUri:`https://court.example/docket/${value.id}`,
  verifiedAt:"2026-07-23T01:00:00Z",...value,
});

describe("deterministic case status v2",()=>{
  it("replays events deterministically with source and verification time",()=>{
    const events=[event({id:"2",type:"motion_to_dismiss_denied",occurredOn:"2026-05-12"}),event({id:"1",type:"complaint_filed",occurredOn:"2026-04-03"})];
    expect(replayStatus(events)).toEqual(replayStatus([...events].reverse()));
    expect(replayStatus(events)).toMatchObject({activity:"active",phase:"pleadings",verification:"verified",ruleVersion:STATUS_RULE_VERSION,source:{eventId:"2",verifiedAt:"2026-07-23T01:00:00Z"},prediction:null});
  });
  it("preserves the last fact and requests review for ambiguity",()=>{
    const status=replayStatus([event({id:"1",type:"complaint_filed",occurredOn:"2026-04-03"}),event({id:"2",type:"ambiguous",occurredOn:"2026-05-20",sourceLabel:"Unclear minute entry"})]);
    expect(status.verification).toBe("needs_review");expect(status.fact).toContain("complaint was filed");expect(status.reviewReason).toContain("could not be mapped");expect(status.prediction).toBeNull();
  });
  it("separates procedural possibilities from verified facts",()=>{
    const status=replayStatus([event({id:"1",type:"judgment_entered",occurredOn:"2026-06-18"})]);
    expect(status.fact).toBe("Judgment was entered on 2026-06-18.");expect(status.proceduralPossibilities[0]).toContain("may be available");expect(status.prediction).toBeNull();
  });
  it("distinguishes partial disposition from complete judgment",()=>{
    expect(replayStatus([event({id:"1",type:"summary_judgment_granted_partial",occurredOn:"2026-02-06"})])).toMatchObject({activity:"active",disposition:"partial"});
    expect(replayStatus([event({id:"2",type:"judgment_entered",occurredOn:"2026-06-18"})])).toMatchObject({activity:"closed",disposition:"complete",judgment:"entered",appeal:"eligible"});
  });
  it("starts unverified without invented next steps",()=>{expect(initialCaseStatus).toMatchObject({verification:"not_verified",proceduralPossibilities:[],prediction:null,source:null});});
});
