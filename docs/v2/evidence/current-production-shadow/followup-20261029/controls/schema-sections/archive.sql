\restrict qqq
--
-- Name: afl_api_brownlow_vote; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.afl_api_brownlow_vote (
    id integer,
    eligible boolean NOT NULL,
    votes integer
);

--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id integer
);

--
-- Name: TABLE players; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.players TO afldb_app;
GRANT SELECT ON TABLE public.players TO afldb_import;

