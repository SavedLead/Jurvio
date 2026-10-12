-- Backfill federal court verification from the authoritative registry.
--
-- The CourtListener bulk court loader historically recorded every court as `not_verified`
-- and never promoted it, so authentic federal courts stayed unverified and blocked
-- publication. The loader is now registry-driven (see federal-court-registry.ts); this
-- migration applies the same authoritative allowlist once to courts already loaded.
--
-- It ONLY promotes registered CourtListener courts to `verified`. It never downgrades a
-- court (so courts another authoritative pipeline verified are untouched) and never
-- verifies a court on the provider label alone -- ids absent from this list (administrative
-- tribunals, state/mismatched/ambiguous entries, the Supreme Court) keep their current
-- verification. The id list mirrors the registry at the time of writing; later changes to
-- the registry are applied by the loader on the next bulk refresh or a follow-up migration.

WITH registered(provider_court_id) AS (VALUES
  ('akb'), ('akd'), ('ald'), ('almb'), ('almd'), ('alnb'), ('alnd'), ('alsb'), ('alsd'), ('arb'),
  ('ard'), ('areb'), ('ared'), ('arwb'), ('arwd'), ('azd'), ('bap1'), ('bap10'), ('bap2'), ('bap6'),
  ('bap8'), ('bap9'), ('bapma'), ('bapme'), ('bta'), ('ca1'), ('ca10'), ('ca11'), ('ca2'), ('ca3'),
  ('ca4'), ('ca5'), ('ca6'), ('ca7'), ('ca8'), ('ca9'), ('cacb'), ('cacd'), ('cadc'), ('caeb'),
  ('caed'), ('cafc'), ('californiad'), ('canalzoned'), ('canb'), ('cand'), ('casb'), ('casd'), ('cavc'), ('cc'),
  ('ccpa'), ('circtcapefearnc'), ('circtdal'), ('circtdalb'), ('circtdalbanyny'), ('circtdar'), ('circtdca'), ('circtdco'), ('circtdct'), ('circtddc'),
  ('circtdedenton'), ('circtdel'), ('circtdga'), ('circtdia'), ('circtdid'), ('circtdil'), ('circtdin'), ('circtdks'), ('circtdky'), ('circtdla'),
  ('circtdma'), ('circtdmd'), ('circtdme'), ('circtdmi'), ('circtdmn'), ('circtdmo'), ('circtdms'), ('circtdmt'), ('circtdnd'), ('circtdne'),
  ('circtdnewbern'), ('circtdnh'), ('circtdnj'), ('circtdnv'), ('circtdoh'), ('circtdor'), ('circtdpa'), ('circtdpamptico'), ('circtdri'), ('circtdsc'),
  ('circtdsd'), ('circtdterrar'), ('circtdtx'), ('circtdut'), ('circtdva'), ('circtdvt'), ('circtdwa'), ('circtdwi'), ('circtdwilm'), ('circtdwv'),
  ('circtdwy'), ('circtedar'), ('circtedil'), ('circtedky'), ('circtedla'), ('circtedmi'), ('circtedmo'), ('circtednc'), ('circtedny'), ('circtedok'),
  ('circtedpa'), ('circtedsc'), ('circtedtn'), ('circtedtx'), ('circtedva'), ('circtedwa'), ('circtedwi'), ('circtmdal'), ('circtmdpa'), ('circtmdtn'),
  ('circtmissterr'), ('circtnc'), ('circtndal'), ('circtndca'), ('circtndfl'), ('circtndga'), ('circtndil'), ('circtndms'), ('circtndny'), ('circtndoh'),
  ('circtndtx'), ('circtndwv'), ('circtnia'), ('circtny'), ('circtsdal'), ('circtsdca'), ('circtsdfl'), ('circtsdga'), ('circtsdia'), ('circtsdil'),
  ('circtsdms'), ('circtsdny'), ('circtsdoh'), ('circtsdtex'), ('circtsdwv'), ('circttenn'), ('circtwdar'), ('circtwdky'), ('circtwdla'), ('circtwdmi'),
  ('circtwdmo'), ('circtwdnc'), ('circtwdny'), ('circtwdok'), ('circtwdpa'), ('circtwdtex'), ('circtwdtn'), ('circtwdva'), ('circtwdwa'), ('circtwdwi'),
  ('cit'), ('cob'), ('cod'), ('com'), ('ctb'), ('ctd'), ('cusc'), ('dcb'), ('dcd'), ('deb'),
  ('ded'), ('eca'), ('fisc'), ('fiscr'), ('fld'), ('flmb'), ('flmd'), ('flnb'), ('flnd'), ('flsb'),
  ('flsd'), ('gad'), ('gamb'), ('gamd'), ('ganb'), ('gand'), ('gasb'), ('gasd'), ('gub'), ('gud'),
  ('hib'), ('hid'), ('iad'), ('ianb'), ('iand'), ('iasb'), ('iasd'), ('idb'), ('idd'), ('ilcb'),
  ('ilcd'), ('illinoisd'), ('illinoised'), ('ilnb'), ('ilnd'), ('ilsb'), ('ilsd'), ('indianad'), ('innb'), ('innd'),
  ('insb'), ('insd'), ('jpml'), ('ksb'), ('ksd'), ('kyd'), ('kyeb'), ('kyed'), ('kywb'), ('kywd'),
  ('lad'), ('laeb'), ('laed'), ('lamb'), ('lamd'), ('lawb'), ('lawd'), ('mab'), ('mad'), ('mdb'),
  ('mdd'), ('meb'), ('med'), ('michd'), ('mieb'), ('mied'), ('missd'), ('miwb'), ('miwd'), ('mnb'),
  ('mnd'), ('mod'), ('moeb'), ('moed'), ('mowb'), ('mowd'), ('msnb'), ('msnd'), ('mssb'), ('mssd'),
  ('mtb'), ('mtd'), ('ncd'), ('nceb'), ('nced'), ('ncmb'), ('ncmd'), ('ncwb'), ('ncwd'), ('ndb'),
  ('ndd'), ('nebraskab'), ('ned'), ('nhb'), ('nhd'), ('njb'), ('njd'), ('nmb'), ('nmd'), ('nmib'),
  ('nmid'), ('nvb'), ('nvd'), ('nyd'), ('nyeb'), ('nyed'), ('nynb'), ('nynd'), ('nysb'), ('nysd'),
  ('nywb'), ('nywd'), ('ohiod'), ('ohnb'), ('ohnd'), ('ohsb'), ('ohsd'), ('okd'), ('okeb'), ('oked'),
  ('oknb'), ('oknd'), ('okwb'), ('okwd'), ('orb'), ('ord'), ('orld'), ('paeb'), ('paed'), ('pamb'),
  ('pamd'), ('pawb'), ('pawd'), ('pennsylvaniad'), ('prb'), ('prd'), ('reglrailreorgct'), ('rib'), ('rid'), ('scb'),
  ('scd'), ('sdb'), ('sdd'), ('southcarolinaed'), ('southcarolinawd'), ('tax'), ('tecoa'), ('tennessed'), ('tennesseeb'), ('texd'),
  ('tneb'), ('tned'), ('tnmb'), ('tnmd'), ('tnwb'), ('tnwd'), ('txeb'), ('txed'), ('txnb'), ('txnd'),
  ('txsb'), ('txsd'), ('txwb'), ('txwd'), ('usberlinct'), ('uscfc'), ('uscirct'), ('usdistct'), ('usprovctla'), ('utb'),
  ('utd'), ('vad'), ('vaeb'), ('vaed'), ('vawb'), ('vawd'), ('vib'), ('vid'), ('vtb'), ('vtd'),
  ('waeb'), ('waed'), ('washd'), ('wawb'), ('wawd'), ('wieb'), ('wied'), ('wisd'), ('wiwb'), ('wiwd'),
  ('wvad'), ('wvnb'), ('wvnd'), ('wvsb'), ('wvsd'), ('wyb'), ('wyd')
)
UPDATE court c
SET verification = 'verified'::verification_state, updated_at = now()
FROM registered r, provider p
WHERE p.code = 'courtlistener'
  AND c.provider_id = p.id
  AND c.provider_court_id = r.provider_court_id
  AND c.verification IS DISTINCT FROM 'verified'::verification_state;
