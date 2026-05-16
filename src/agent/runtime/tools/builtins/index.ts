import tool0 from "./apply_patch.js";
import tool1 from "./artifact_present.js";
import tool2 from "./cron_list.js";
import tool3 from "./cron_register.js";
import tool4 from "./delete_file.js";
import tool5 from "./edit_file.js";
import tool6 from "./email.js";
import tool7 from "./file_diff.js";
import tool8 from "./file_stat.js";
import tool9 from "./find_files.js";
import tool10 from "./grep.js";
import tool11 from "./list_dir.js";
import tool12 from "./make_dir.js";
import tool13 from "./memory_recall.js";
import tool14 from "./memory_save.js";
import tool15 from "./memory_search.js";
import tool16 from "./move_file.js";
import tool17 from "./multi_edit.js";
import tool18 from "./read_file.js";
import tool19 from "./run_shell.js";
import tool20 from "./session_memory_append.js";
import tool21 from "./session_memory_list.js";
import tool22 from "./session_search.js";
import tool23 from "./skill_bulk_save.js";
import tool24 from "./skill_delete.js";
import tool25 from "./skill_list.js";
import tool26 from "./skill_manage.js";
import tool27 from "./skill_recall.js";
import tool28 from "./skill_save.js";
import tool29 from "./skill_view.js";
import tool30 from "./system_info.js";
import tool31 from "./todo_write.js";
import tool32 from "./tree.js";
import tool33 from "./vision_analyze.js";
import tool34 from "./web_fetch.js";
import tool35 from "./web_search.js";
import tool36 from "./wiki_search.js";
import tool37 from "./wiki_setup.js";
import tool38 from "./wiki_sync.js";
import tool39 from "./write_file.js";
import tool40 from "./youtube_transcribe.js";

export const BUILTIN_TOOL_DEFINITIONS = [
  tool0,
  tool1,
  tool2,
  tool3,
  tool4,
  tool5,
  tool6,
  tool7,
  tool8,
  tool9,
  tool10,
  tool11,
  tool12,
  tool13,
  tool14,
  tool15,
  tool16,
  tool17,
  tool18,
  tool19,
  tool20,
  tool21,
  tool22,
  tool23,
  tool24,
  tool25,
  tool26,
  tool27,
  tool28,
  tool29,
  tool30,
  tool31,
  tool32,
  tool33,
  tool34,
  tool35,
  tool36,
  tool37,
  tool38,
  tool39,
  tool40,
] as const;
