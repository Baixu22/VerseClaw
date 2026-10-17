# Live turn: network connection error (N7)

Facts gathered:
- the isolated runtime config carries a well-formed provider entry: { baseUrl, api, models: [{id, name}], apiKey }
- with the derived runtime provider key in the agent model ref the runtime stops saying unknown-model and reports LLM request failed: network connection error
- an in-process stub server on 127.0.0.1 receives ZERO requests in that state, and the runtime log dir does not exist in the isolated home

Environment note: this machine has HTTP_PROXY and HTTPS_PROXY set to http://127.0.0.1:7897. Setting NO_PROXY/no_proxy to 127.0.0.1,localhost for the Playwright run did NOT change the
outcome, so either the app does not inherit that variable or its HTTP client ignores it.

Interpretation: the ClawX-side wiring is correct up to the outbound call (provider entry + model resolution), and the remaining failure is at the network layer of the runtime model
client. Next avenues: inspect the runtime HTTP client/proxy handling, or run the same diagnostic where no local proxy is set.
