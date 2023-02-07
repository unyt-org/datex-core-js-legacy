# * Short hash for signatures
# * DBView delete rows!!
# * serialize() return SerializableWithVariables includes 'variables' from Variable class, for self circular objects
# * internal _number variables (should not be usedd in normal datex script)
# * NEW TSCONFIG enable in uix directory
# * Infinity & NaN in DATEX
# * only enable garbage collect if no subscribers for pointer (after some timeout, at least REQUEST_TIMEOUT)
# * optional DatexError "stack tracing" (including endpoint, ...), escpecially for Runtime errors
# * ; at end of function (datex block) required?!, otherwise compilation bug
# * option to interpret <Int> as bigint or number
# * merge @call & @get? NO
# * @no_response
# * (<ext:Player>()).position_x; TypeError: Cannot read properties of undefined (reading 'toString')
# * FORCE GARBAGE COLLECTION FOR SYNC OBJECTS (only anonymous working correctly)
# * important! impersonation permission: <Function> and @sync classes with synced pointer properties create new pointers indirectly! 
# * Casting class 'constructor' from tuple (use as constructor arguments)
# * remove / change constructorArgSwitch in sync class constructor
# * dont allow subscribing to own pointers
# * fun  returns DATEXCOdeblock
# * too many ;?
# * todo move Tuple handling into handleApply for DatexFunction  -> functions can also be called from js with tuples / not! (creates problems with ts/js!)
# * use scope variables as meta
# * make sender, signed, etc. variables constant (only readable)
# * direct variable assign command
# * return xy not always returning? : console output only accepts one result, returns global + return, order can change
# * object keys insert value overswrite valur if already exists!!
# * enable $00 pointer assignments in DATEX scripts
# * enable pointer assignments with automatically assigned pointer ID in DATEX scripts
# * @namespace decorator for sync class types (<namespace:xxxx>) no longer needed
# * typecast from right to left after no other value coming
# * DATEX delete var...
# * <Int> x = '12'
# * if to switch
# * integers as <Float>int


* -(2 + 2)
* basic calculations (+ - * /)
* enable/disable context menu for UIX elements
* send no body for void response or only 0xa0!
* Typscript -> JS Field declarator differences! -> migrate to new JS behaviour (useDefineForClassFields), values always initialized as undefined
* argument type inheritence in sync classes
* Datex complex filters handle redirect!!
* make optional: call functions locally via handleApply (argument type checking) or directly
* Hide exposed properties of Datex specific classes (e.g DatexFunction, DatexFilter)
* Vulnerability?: set malicious function as pointer value, assume that function is eventually executed by remote endpoint (with his permissions!)
* CompilerCommand objects to insert into compiler to avoid string (DATEX script) parsing
* Streams over DATEX (1 per channel, blocks the channel?)
* @type(DatexType) decorator for function arguments
* @allow_unsigned methods/properties
* UIX fix .has-border (dynamic, border size can be other size than 2px!)
* @anonymous sync classes - all instance have a $0 pointer
* @to classes - only allow those endpoints access to the class (DATEX type casting, etc)
* UIX show only required edit controllers (to move elements)
* UIX detect trackpad or mouse for required x-scrollbars
* highlight sync([]) and norrmal Array differences in DOCS (empty vs. undefined values!)
* prevent pointer spamming (creating lots of pointers on remote endpoint, filling memory)
* Important: Pointer origin only indicates sync origin, does not guarantee that the pointer was created by that endpoint
* use Tuple as ... spread opertator (spread elements in array after casting other array to tuple , ...)
* return in sessions not counting up?
* stop only compiler command?
* cache receivers for SESSION_REQ (on nodes), don't resend
* /* channel for endpoints -> send to all availalble channels for this endpoint
* UIX language selection element
* removed DatexRuntime.callbacks_by_sid after callback called :: check if any problems because callback still needed!! (sessions?)
* clear DatexCompiler.sid_incs for no longer needed sids
* request - object in DATEX for more complex requests (cast from CodeBlock, add signed, encrpyted, protocol_data_type, etc.)
* garbage collection not working after all subscribers have unsubscribed?
* DATEX namespace(x,y,z) like use(...) for default type namespaces
* DATEX design (for DOCS): at no time there should be a command in the dxb that creates a irreverisable state of the scope (exception: consts?)
  (continuos dx stream)
* DATEX design: whitespaces should be redundant (not always the case, e.g. x::a vs x: :a)
* DATEXII EU
* recursive object problems with custom types like map (custom indexation, does not correspond to serialized indexation)
* names and concepts: portal
* Local DATEX requests response also parsed? (redundant)
* Compare scope wide object references (not only recursive inside one object)
* also only make object property = value definitions outside the object if actual self-reference (otherwise directly add inside the object)
* garbage collection of properties??
* send all internal variables to meta (or custom meta variables)
* jump from console values to tree view







* Tasks for Unyt and Profit generation
  * authorize target associations (@alias+app:org, @alias+unyt, @alias, +app, *node, :org) (#labels not in blockchain) with ids
  * each target is associated with an id (blockchain index) %1124567/xy = @alias+app/xy
  * verify to unyt with a registered alias -> create / delete new app aliases 
  * endpoints associations/public keys are available as soon as the signed transaction from unyt is sent to the blockchain network (can also be in a pending block)
  * root authority nodes/endpoint to get public keys (compare multiple answers)

# encrpytion: 
  * Send endpoint,encrypted(sym key) pairs in header (in receivers list)
  * REQUEST_KEY request to force get new/first key / key for a specific scope id?
  * as long as no new sym key is sent, the current sym key is valid
  * body is encrypted with sym key + iv
  => HEADER + iv field
  => HEADER + sym keys (inside signed part!!!)




* time to live
# * block sorting
* timeouts
* error correction bits
# * array buffer overflow?? e.g. html files in file editor contain raw DATEX ??!?
# * move logger.ts to unyt_core

# * x = 1,3,4,4;print x;=> ValueError: Variable not found: x ??!?!

# * grid-element position was absolute before; check if any glitches?!?
# ids for alle endpoints  

# LOGIN
  * user sends alias and password hash to unyt
  * unyt compares password hash for alias, returns private key snippet if correct
  * user combines private key snippet and password (add or subtract password from key snipppet) to get the private key
  * user connects to the DATEX network with his private key

  *   20asdm2infa_private_keyfjffo3dfokogmn_njak (from unyt server)
    - PASSWORD_XYZ.....extended.................   (user input)
    = actual_private_key


blockchain : Proof of selection

# BLOCKCHAIN

## Default Blockchain entry types
  * Id    -> Sign Key - Enc Key
  * Sender - Receiver - Amout - Reference

## Unyt managed (signed by unyt)
  * Alias -> Id      (can be changed)
  * Alias -> Verfier (verfied, real person) (can be changed)
  * Label -> Filter (can be changed)

## Custom Blockchain entries
  * Included fee to unyt
  * Only with unyt account -> alias/bots
  
## Storing the Blockchain
  * save each block in a database (full node)
  * only the last part of the blockchain might be stored (half node)

## Downloading a Blockchain
  * request the last blockchain hash from multiple nodes
  * compare if consistent
  * fetch and validate the blockchain with the hash

## Transmit Blocks via Datex
  * <Block> ['custom_transaction', 223,@sdf,3u,<Set>[]]