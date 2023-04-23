## interface **ComInterface**

## class **CommonInterface**
### Constructors
 **constructor**(endpoint: Endpoint)

### Properties
**default_interface**: ComInterface<br>
**type**: string<br>
**persistent**: boolean<br>
**authorization_required**: boolean<br>
**endpoint**: Endpoint<br>
**endpoints**: Set<br>
**virtual**: boolean<br>
**in**: boolean<br>
**out**: boolean<br>
**global**: boolean<br>
**CONNECTED**: symbol<br>
`protected` **endpoint_connection_points**: Map<br>
`protected` **indirect_endpoint_connection_points**: Map<br>
`protected` **virtual_endpoint_connection_points**: Map<br>
`protected` **logger**: Logger<br>
`protected` **initial_arguments**: any[]<br>
`protected` **connecting**: boolean<br>
`protected` **reconnecting**: boolean<br>

common class for all client interfaces (WebSockets, TCP Sockets, GET Requests, ...)

## class **LocalClientInterface**
### Properties
`override` **type**: string<br>
`override` **persistent**: boolean<br>
`override` **authorization_required**: boolean<br>
`override` **in**: boolean<br>
`override` **out**: boolean<br>
`override` **global**: boolean<br>
**datex_in_handler**: any<br>

'Local' interface

## class **RelayedClientInterface**
### Properties
`override` **type**: string<br>
`override` **authorization_required**: boolean<br>
`override` **in**: boolean<br>
`override` **out**: boolean<br>
`override` **global**: boolean<br>
`override` **virtual**: boolean<br>

'Relayed' interface

## class **BluetoothClientInterface**
### Properties
`override` **type**: string<br>
`override` **authorization_required**: boolean<br>
`override` **in**: boolean<br>
`override` **out**: boolean<br>
`override` **global**: boolean<br>

'Bluetooth' interface

## class **SerialClientInterface**
### Properties
`override` **type**: string<br>
`override` **authorization_required**: boolean<br>
`override` **in**: boolean<br>
`override` **out**: boolean<br>
`override` **global**: boolean<br>

'Serial' interface (USB, ...)

## class **WebRTCClientInterface**
### Constructors
 **constructor**(endpoint: Endpoint)

### Properties
`override` **type**: string<br>
**connection**: RTCPeerConnection<br>
**data_channel_out**: RTCDataChannel<br>
**data_channel_in**: RTCDataChannel<br>
`override` **in**: boolean<br>
`override` **out**: boolean<br>
`override` **global**: boolean<br>
**waiting_interfaces_by_endpoint**: Map<br>

'Relayed' interface

## class **InterfaceManager**
### Properties
**logger**: Logger<br>
**datex_in_handler**: unknown - todo<br>
**local_interface**: LocalClientInterface<br>
**interfaces**: Map<br>
**receive_listeners**: Set<br>
**new_interface_listeners**: Set<br>
**interface_connected_listeners**: Set<br>
**interface_disconnected_listeners**: Set<br>
**active_interfaces**: Set<br>


## class **default**
### Properties
**logger**: Logger<br>
**datex_in_handler**: unknown - todo<br>
**local_interface**: LocalClientInterface<br>
**interfaces**: Map<br>
**receive_listeners**: Set<br>
**new_interface_listeners**: Set<br>
**interface_connected_listeners**: Set<br>
**interface_disconnected_listeners**: Set<br>
**active_interfaces**: Set<br>


