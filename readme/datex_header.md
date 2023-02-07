### DATEX v2 HEADER

[0] = 0x01; 
[1] = 0x64; `d`
[2] = 0x78; `x`
[3] = 0x62; `b`


## START ROUTING HEADER
# // those parameters can be changed during routing //////////
[0] = [routing_header_size]
[1] = [ttl] -> decrement down to zero
[2] = [priority] -> higher priority blocks are handled first

[3] = // DNF Filters for redirects
...
## ///////////////////////////////////////////////////////////

## MAIN HEADER

[4] = [is_signed]
[5] = [signature]  -> sign everything below the signature (exclude dynamic routing part)
...
[260]

[261] = [header_size] // size of the header
[262]


[263] = [sid]
[264]
[265]
[266]

[277] = [sid:#]
[278]
[279]
[280]

[281] = [sender_type]
[282] = [sender_name]
...
[299]
[300] = [sender_channel]
...
[307]

[308] = [type] -> eg, blockchain transaction request, data_storage, datex request, cached_datex_request, ack


# optional ::: 

[309] = [version_number]

[310] = [is_body_encrypted] [is_body_executable] [is_last_block_of_scope] + 5 bytes device_type


[311] = [timestamp_in_ms]
..
[318]


[207] = [receiver_filter_type] -> single unique receiver, DNF Filters, or pointer to DNF Filter
[308] = [receiver_filter_pointer_id_or_filter] -> indicate which pointer should be assigned to this filter in the future
// or DNF filter

[zz] = [encryption_key] // if encrypted

## END HEADER


## BODY ------------------------------------------------------------






## ------------------------------------------------------------------



# DNF Filters
// all individual filters

[291] = [receiver_filter_count]

[x1] = [atomic_filter_1]
[x2] = [atomic_filter_2]
...

(
    [yy] = [not] // dont negate next filter
    [yy] = [atomic_filter_1] // filter 1
    [yy] = [] // dont negate next filter
    [yy] = [atomic_filter_2] // and filter 2
    [yy] = [not] // negate next filter
    [yy] = [atomic_filter_3] // and filter 3

    ([zz] = [key]) // if encrypted
)[xx] // or

# max filter (alias) size: 24 


## Datex Blockchain Entry
[0] = 0x01; 
[1] = 0x64; `d`
[2] = 0x78; `x`
[3] = 0x63; `c`

...