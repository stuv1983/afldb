\restrict zzz
--
-- Name: afl_api_brownlow_vote; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.afl_api_brownlow_vote (
    id integer,
    eligible boolean,
    votes integer
);

--
-- Name: COLUMN afl_api_brownlow_vote.eligible; Type: COMMENT; Schema: staging; Owner: -
--

COMMENT ON COLUMN staging.afl_api_brownlow_vote.eligible IS 'The provider''s explicit Brownlow eligibility boolean for this vote record. NULL = the provider value was absent, null or not a boolean (UNKNOWN); never an implicit false. BP-2025-ELIGIBILITY-v1.';

--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id integer
);

--
-- Name: brownlow_correction_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brownlow_correction_receipts (
    plan_digest text NOT NULL
);

--
-- Name: brownlow_correction_receipts brownlow_correction_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brownlow_correction_receipts
    ADD CONSTRAINT brownlow_correction_receipts_pkey PRIMARY KEY (plan_digest);

--
-- Name: refuse_brownlow_receipt_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refuse_brownlow_receipt_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS \$\$x\$\$;

--
-- Name: ix_afl_api_identity_adjudications_supersedes_id; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX ix_afl_api_identity_adjudications_supersedes_id ON staging.afl_api_identity_adjudications USING btree (supersedes_id);

--
-- Name: TABLE players; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.players TO afldb_import;
GRANT SELECT ON TABLE public.players TO afldb_app;

--
-- Name: TABLE brownlow_correction_receipts; Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON TABLE public.brownlow_correction_receipts FROM PUBLIC;

\unrestrict zzz
