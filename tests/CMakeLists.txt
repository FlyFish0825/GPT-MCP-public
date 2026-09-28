cmake_minimum_required(VERSION 3.15)
project(GPT_MCP_Acceptance NONE)
add_custom_target(acceptance ALL COMMAND ${CMAKE_COMMAND} -E echo "MCP_CMAKE_BUILD_OK")
