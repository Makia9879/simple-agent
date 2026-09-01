// Package schema documents the Hub tables independently from generated Ent code.
// Production migration SQL is the executable source used by the minimal build.
package schema

type Field struct {
	Name, SQLType    string
	Nullable, Unique bool
}
type Index struct {
	Columns []string
	Unique  bool
}
type HubSchema struct {
	Table   string
	Fields  []Field
	Indexes []Index
}

var HubSchemas = []HubSchema{
	{Table: "hub_groups", Fields: []Field{{"id", "varchar(64)", false, true}, {"name", "varchar(120)", false, true}, {"status", "varchar(16)", false, false}}},
	{Table: "hub_group_members", Fields: []Field{{"group_id", "varchar(64)", false, false}, {"user_id", "varchar(64)", false, false}}, Indexes: []Index{{[]string{"group_id", "user_id"}, true}}},
	{Table: "hub_providers", Fields: []Field{{"provider", "varchar(64)", false, true}, {"name", "varchar(120)", false, false}, {"status", "varchar(16)", false, false}, {"last_synced_at", "datetime(6)", true, false}}},
	{Table: "hub_models", Fields: []Field{{"id", "varchar(64)", false, true}, {"provider", "varchar(64)", false, false}, {"upstream_model_id", "varchar(191)", false, false}, {"name", "varchar(191)", false, false}, {"enabled", "boolean", false, false}, {"available", "boolean", false, false}}, Indexes: []Index{{[]string{"provider", "upstream_model_id"}, true}}},
	{Table: "hub_grants", Fields: []Field{{"subject_type", "varchar(8)", false, false}, {"subject_id", "varchar(64)", false, false}, {"model_id", "varchar(64)", false, false}}, Indexes: []Index{{[]string{"subject_type", "subject_id", "model_id"}, true}}},
	{Table: "hub_conversations", Fields: []Field{{"id", "varchar(64)", false, true}, {"owner_id", "varchar(64)", false, false}, {"model_id", "varchar(64)", false, false}, {"pi_session_ref", "varchar(128)", false, true}, {"title", "varchar(200)", false, false}, {"hidden", "boolean", false, false}}},
	{Table: "hub_usage_records", Fields: []Field{{"request_id", "varchar(64)", false, true}, {"conversation_id", "varchar(64)", false, false}, {"user_id", "varchar(64)", false, false}, {"model_id", "varchar(64)", false, false}, {"status", "varchar(16)", false, false}, {"input_tokens", "bigint", true, false}, {"output_tokens", "bigint", true, false}, {"cached_tokens", "bigint", true, false}, {"total_tokens", "bigint", true, false}}},
	{Table: "hub_audit_logs", Fields: []Field{{"id", "bigint", false, true}, {"actor_id", "varchar(64)", false, false}, {"action", "varchar(80)", false, false}, {"object_type", "varchar(40)", false, false}, {"object_id", "varchar(64)", false, false}, {"result", "varchar(16)", false, false}, {"trace_id", "varchar(64)", false, false}}},
}
