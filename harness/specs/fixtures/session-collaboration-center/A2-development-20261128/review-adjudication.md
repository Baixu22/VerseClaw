# A2 接力验证记录

unit-r1的query35项通过；第二文件在稀疏检出中缺失，Vitest收集0项退出1。已从同一HEAD恢复原文件，保持产品代码不变。unit-r2六文件全过；该跑次是UI修订前候选，保留原结果。

autoreview-r1发现真实列表在权限拒绝后仍保留旧缓存。已接纳并修复：not-visible清列表/详情/游标/选择；detailEpoch同步失效旧读取，防止迟到snapshot回填。新增真实Panel回归与原Gateway权限撤销Electron场景。最新候选由unit-r3及autoreview-r2重新验证。

autoreview-r2发现刷新前策略收紧时列表会正常返回过滤结果，选中详情未清除。最新修订在成功页不含当前选择时追加有界target复核，确认撤权或身份失效才清选择，并核对refresh revision和selected key；搜索/分页隐藏的合法选择继续保留。unit-r3旧候选7文件通过，最新候选由unit-r4/autoreview-r3验证。
